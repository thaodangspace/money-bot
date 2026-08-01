package sheets

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/thaodangspace/money-bot/domain"
)

func NewRepository(api API, spreadsheetID, metadataSheet string, location *time.Location) (*Repository, error) {
	if api == nil {
		return nil, errors.New("sheets API is required")
	}
	if strings.TrimSpace(spreadsheetID) == "" {
		return nil, errors.New("spreadsheet ID is required")
	}
	if strings.TrimSpace(metadataSheet) == "" {
		metadataSheet = "_money_bot_meta"
	}
	if location == nil {
		location = time.UTC
	}
	return &Repository{api: api, spreadsheetID: spreadsheetID, metadataSheet: metadataSheet, location: location, maxRetries: 1, now: time.Now}, nil
}

func (r *Repository) SetClock(now func() time.Time) {
	if now != nil {
		r.now = now
	}
}

func (r *Repository) SetMaxRetries(maxRetries int) {
	if maxRetries >= 0 {
		r.maxRetries = maxRetries
	}
}

func (r *Repository) AppendTransaction(ctx context.Context, tx domain.Transaction) (AppendResult, error) {
	if tx.SourceUpdateID <= 0 {
		return AppendResult{}, errors.New("source update ID is required")
	}
	return r.AppendTransactions(ctx, tx.SourceUpdateID, []domain.Transaction{tx})
}

func (r *Repository) AppendTransactions(ctx context.Context, updateID int, transactions []domain.Transaction) (AppendBatchResult, error) {
	if updateID <= 0 {
		return AppendBatchResult{}, errors.New("source update ID is required")
	}
	if len(transactions) == 0 || len(transactions) > 20 {
		return AppendBatchResult{}, errors.New("transaction batch size is invalid")
	}

	type datedTransaction struct {
		date  time.Time
		tx    domain.Transaction
		sheet string
	}
	dated := make([]datedTransaction, 0, len(transactions))
	targets := make(map[string]struct{}, len(transactions))
	seenTransactions := make(map[string]struct{}, len(transactions))
	fallbackDate := r.now().In(r.location)
	for _, tx := range transactions {
		tx.SourceUpdateID = updateID
		if err := tx.Validate(); err != nil {
			return AppendBatchResult{}, err
		}
		date := fallbackDate
		if !tx.Date.IsZero() {
			date = tx.Date.In(r.location)
		}
		tx.Date = date
		key := fmt.Sprintf("%s\\x00%s\\x00%d\\x00%s\\x00%s", tx.Type, tx.Category, tx.Amount, tx.Note, date.Format("2006-01-02"))
		if _, ok := seenTransactions[key]; ok {
			return AppendBatchResult{}, errors.New("duplicate transaction in batch")
		}
		seenTransactions[key] = struct{}{}
		sheet := monthSheet(date.Year(), date.Month())
		targets[sheet] = struct{}{}
		dated = append(dated, datedTransaction{date: date, tx: tx, sheet: sheet})
	}

	// The update ID is checked once for the complete batch, before worksheet setup.
	seen, err := r.hasUpdateID(ctx, updateID)
	if err != nil {
		return AppendBatchResult{}, err
	}
	if seen {
		return AppendBatchResult{Status: AppendDuplicate, TargetSheet: strings.Join(sortedKeys(targets), ",")}, nil
	}
	targetSheets := sortedKeys(targets)
	if err := r.ensureSheets(ctx, targetSheets); err != nil {
		return AppendBatchResult{}, err
	}
	sheetIDs, err := r.sheetIDs(ctx)
	if err != nil {
		return AppendBatchResult{}, err
	}
	metaID, metaOK := sheetIDs[r.metadataSheet]
	if !metaOK {
		return AppendBatchResult{}, fmt.Errorf("required metadata worksheet ID not found after ensure")
	}

	requests := make([]Request, 0, len(targetSheets)+1)
	for _, targetSheet := range targetSheets {
		values := make([][]string, 0, len(dated))
		for _, item := range dated {
			if item.sheet == targetSheet {
				values = append(values, flatTransactionRow(item.date, item.tx))
			}
		}
		sheetID, ok := sheetIDs[targetSheet]
		if !ok {
			return AppendBatchResult{}, fmt.Errorf("required worksheet %q not found after ensure", targetSheet)
		}
		requests = append(requests, Request{AppendCells: &AppendCellsRequest{SheetID: sheetID, SheetTitle: targetSheet, Values: values}})
	}
	requests = append(requests, Request{AppendCells: &AppendCellsRequest{SheetID: metaID, SheetTitle: r.metadataSheet, Values: [][]string{metadataRow(updateID, r.now().In(time.UTC), strings.Join(targetSheets, ","), string(AppendWritten))}}})

	var lastErr error
	for attempt := 0; attempt <= r.maxRetries; attempt++ {
		err = r.api.BatchUpdate(ctx, r.spreadsheetID, BatchUpdateRequest{Requests: requests})
		if err == nil {
			return AppendBatchResult{Status: AppendWritten, TargetSheet: strings.Join(targetSheets, ",")}, nil
		}
		lastErr = err
		if !IsAmbiguous(err) {
			return AppendBatchResult{}, err
		}
		seen, checkErr := r.hasUpdateID(ctx, updateID)
		if checkErr != nil {
			lastErr = errors.Join(err, checkErr)
			break
		}
		if seen {
			return AppendBatchResult{Status: AppendWritten, TargetSheet: strings.Join(targetSheets, ",")}, nil
		}
	}
	return AppendBatchResult{}, lastErr
}

func flatTransactionRow(date time.Time, tx domain.Transaction) []string {
	return []string{
		date.Format("02/01/2006"),
		string(tx.Type),
		tx.Content(),
		strconv.FormatInt(tx.Amount, 10),
	}
}

func metadataRow(updateID int, processedAt time.Time, targetSheet, outcome string) []string {
	return []string{
		MetadataSchemaVersion,
		strconv.Itoa(updateID),
		processedAt.UTC().Format(time.RFC3339Nano),
		targetSheet,
		outcome,
	}
}

func (r *Repository) ensureSheets(ctx context.Context, targetSheets []string) error {
	spreadsheet, err := r.api.GetSpreadsheet(ctx, r.spreadsheetID)
	if err != nil {
		return err
	}
	sheets := map[string]Sheet{}
	for _, sheet := range spreadsheet.Sheets {
		sheets[sheet.Title] = sheet
	}
	var req BatchUpdateRequest
	for _, targetSheet := range targetSheets {
		if _, ok := sheets[targetSheet]; !ok {
			req.Requests = append(req.Requests, Request{AddSheet: &AddSheetRequest{Title: targetSheet}})
		}
	}
	if meta, ok := sheets[r.metadataSheet]; !ok {
		req.Requests = append(req.Requests, Request{AddSheet: &AddSheetRequest{Title: r.metadataSheet, Hidden: true}})
	} else {
		if !meta.Hidden {
			req.Requests = append(req.Requests, Request{UpdateSheetProperties: &UpdateSheetPropertiesRequest{SheetID: meta.ID, Hidden: true}})
		}
		if err := r.validateMetadataHeader(ctx); err != nil {
			return err
		}
	}
	if len(req.Requests) == 0 {
		return nil
	}
	if err := r.api.BatchUpdate(ctx, r.spreadsheetID, req); err != nil {
		return err
	}
	if _, existed := sheets[r.metadataSheet]; !existed {
		ids, err := r.sheetIDs(ctx)
		if err != nil {
			return err
		}
		metaID, ok := ids[r.metadataSheet]
		if !ok {
			return fmt.Errorf("metadata worksheet ID not found after creation")
		}
		return r.api.BatchUpdate(ctx, r.spreadsheetID, BatchUpdateRequest{Requests: []Request{{AppendCells: &AppendCellsRequest{SheetID: metaID, SheetTitle: r.metadataSheet, Values: [][]string{MetadataHeaders}}}}})
	}
	return nil
}

func (r *Repository) sheetIDs(ctx context.Context) (map[string]int64, error) {
	spreadsheet, err := r.api.GetSpreadsheet(ctx, r.spreadsheetID)
	if err != nil {
		return nil, err
	}
	ids := make(map[string]int64, len(spreadsheet.Sheets))
	for _, sheet := range spreadsheet.Sheets {
		ids[sheet.Title] = sheet.ID
	}
	return ids, nil
}

func (r *Repository) validateMetadataHeader(ctx context.Context) error {
	values, err := r.api.GetValues(ctx, r.spreadsheetID, quoteSheet(r.metadataSheet)+"!A1:E1")
	if err != nil {
		return err
	}
	if len(values) == 0 {
		return fmt.Errorf("metadata sheet %q missing header", r.metadataSheet)
	}
	row := values[0]
	for len(row) < len(MetadataHeaders) {
		row = append(row, "")
	}
	for i, want := range MetadataHeaders {
		if row[i] != want {
			return fmt.Errorf("metadata sheet %q header column %d = %q, want %q", r.metadataSheet, i+1, row[i], want)
		}
	}
	return nil
}

func (r *Repository) hasUpdateID(ctx context.Context, updateID int) (bool, error) {
	values, err := r.api.GetValues(ctx, r.spreadsheetID, quoteSheet(r.metadataSheet)+"!A2:E")
	if err != nil {
		if errors.Is(err, ErrSheetNotFound) {
			return false, nil
		}
		return false, err
	}
	want := strconv.Itoa(updateID)
	for _, row := range values {
		if len(row) >= 2 && strings.TrimSpace(row[1]) == want {
			return true, nil
		}
	}
	return false, nil
}

func sortedKeys(values map[string]struct{}) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func monthSheet(year int, month time.Month) string {
	return fmt.Sprintf("%04d-%02d", year, int(month))
}

func quoteSheet(title string) string {
	return "'" + strings.ReplaceAll(title, "'", "''") + "'"
}
