package sheets

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/dtonair/money-bot/domain"
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
	if err := tx.Validate(); err != nil {
		return AppendResult{}, err
	}
	date := r.now().In(r.location)
	if !tx.Date.IsZero() {
		date = tx.Date.In(r.location)
	}
	targetSheet := monthSheet(date.Year(), date.Month())
	if err := r.ensureSheets(ctx, targetSheet); err != nil {
		return AppendResult{}, err
	}
	seen, err := r.hasUpdateID(ctx, tx.SourceUpdateID)
	if err != nil {
		return AppendResult{}, err
	}
	if seen {
		return AppendResult{Status: AppendDuplicate, TargetSheet: targetSheet}, nil
	}
	sheetIDs, err := r.sheetIDs(ctx)
	if err != nil {
		return AppendResult{}, err
	}
	targetID, targetOK := sheetIDs[targetSheet]
	metaID, metaOK := sheetIDs[r.metadataSheet]
	if !targetOK || !metaOK {
		return AppendResult{}, fmt.Errorf("required worksheet IDs not found after ensure")
	}

	var lastErr error
	for attempt := 0; attempt <= r.maxRetries; attempt++ {
		req := BatchUpdateRequest{Requests: []Request{
			{AppendCells: &AppendCellsRequest{SheetID: targetID, SheetTitle: targetSheet, Values: [][]string{flatTransactionRow(date, tx)}}},
			{AppendCells: &AppendCellsRequest{SheetID: metaID, SheetTitle: r.metadataSheet, Values: [][]string{metadataRow(tx.SourceUpdateID, r.now().In(time.UTC), targetSheet, string(AppendWritten))}}},
		}}
		err = r.api.BatchUpdate(ctx, r.spreadsheetID, req)
		if err == nil {
			return AppendResult{Status: AppendWritten, TargetSheet: targetSheet}, nil
		}
		lastErr = err
		if !IsAmbiguous(err) {
			return AppendResult{}, err
		}
		seen, checkErr := r.hasUpdateID(ctx, tx.SourceUpdateID)
		if checkErr != nil {
			lastErr = errors.Join(err, checkErr)
			break
		}
		if seen {
			return AppendResult{Status: AppendWritten, TargetSheet: targetSheet}, nil
		}
	}
	return AppendResult{}, lastErr
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

func (r *Repository) ensureSheets(ctx context.Context, targetSheet string) error {
	spreadsheet, err := r.api.GetSpreadsheet(ctx, r.spreadsheetID)
	if err != nil {
		return err
	}
	sheets := map[string]Sheet{}
	for _, sheet := range spreadsheet.Sheets {
		sheets[sheet.Title] = sheet
	}
	var req BatchUpdateRequest
	if _, ok := sheets[targetSheet]; !ok {
		req.Requests = append(req.Requests, Request{AddSheet: &AddSheetRequest{Title: targetSheet}})
	}
	if meta, ok := sheets[r.metadataSheet]; !ok {
		req.Requests = append(req.Requests,
			Request{AddSheet: &AddSheetRequest{Title: r.metadataSheet, Hidden: true}},
		)
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

func monthSheet(year int, month time.Month) string {
	return fmt.Sprintf("%04d-%02d", year, int(month))
}

func quoteSheet(title string) string {
	return "'" + strings.ReplaceAll(title, "'", "''") + "'"
}
