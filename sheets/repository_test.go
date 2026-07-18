package sheets

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/dtonair/money-bot/domain"
)

type fakeAPI struct {
	spreadsheet Spreadsheet
	values      map[string][][]string
	batches     []BatchUpdateRequest
	batchErrs   []error
	nextSheetID int64
}

func newFakeAPI() *fakeAPI {
	return &fakeAPI{values: make(map[string][][]string), nextSheetID: 10}
}

func (f *fakeAPI) GetSpreadsheet(context.Context, string) (Spreadsheet, error) {
	return f.spreadsheet, nil
}

func (f *fakeAPI) GetValues(_ context.Context, _ string, readRange string) ([][]string, error) {
	rows, ok := f.values[readRange]
	if !ok {
		return nil, ErrSheetNotFound
	}
	copyRows := make([][]string, len(rows))
	for i := range rows {
		copyRows[i] = append([]string(nil), rows[i]...)
	}
	return copyRows, nil
}

func (f *fakeAPI) BatchUpdate(_ context.Context, _ string, req BatchUpdateRequest) error {
	f.batches = append(f.batches, req)
	var delayedErr error
	if len(f.batchErrs) > 0 {
		delayedErr = f.batchErrs[0]
		f.batchErrs = f.batchErrs[1:]
		if delayedErr != nil && !IsAmbiguous(delayedErr) {
			return delayedErr
		}
	}
	for _, request := range req.Requests {
		if add := request.AddSheet; add != nil {
			f.nextSheetID++
			f.spreadsheet.Sheets = append(f.spreadsheet.Sheets, Sheet{ID: f.nextSheetID, Title: add.Title, Hidden: add.Hidden})
		}
		if upd := request.UpdateSheetProperties; upd != nil {
			for i := range f.spreadsheet.Sheets {
				if f.spreadsheet.Sheets[i].ID == upd.SheetID {
					f.spreadsheet.Sheets[i].Hidden = upd.Hidden
				}
			}
		}
		if appendReq := request.AppendCells; appendReq != nil {
			rng := quoteSheet(appendReq.SheetTitle) + "!A:D"
			if appendReq.SheetTitle == "_money_bot_meta" {
				if len(appendReq.Values) > 0 && reflect.DeepEqual(appendReq.Values[0], MetadataHeaders) {
					f.values[quoteSheet(appendReq.SheetTitle)+"!A1:E1"] = appendReq.Values
					continue
				}
				rng = quoteSheet(appendReq.SheetTitle) + "!A2:E"
			}
			f.values[rng] = append(f.values[rng], appendReq.Values...)
		}
	}
	return delayedErr
}

func TestAppendTransactionCreatesHeaderlessMonthlySheetAndMetadataThenWritesAtomicRows(t *testing.T) {
	api := newFakeAPI()
	repo := mustRepo(t, api)
	fixed := time.Date(2026, 7, 18, 10, 0, 0, 0, time.UTC)
	repo.SetClock(func() time.Time { return fixed })
	tx := domain.Transaction{Category: "food", Note: "pizza", OriginalMessage: "ăn tối 150k pizza", Amount: 150000, Type: domain.TransactionExpense, Date: fixed, SourceUpdateID: 99}

	result, err := repo.AppendTransaction(context.Background(), tx)
	if err != nil {
		t.Fatalf("AppendTransaction() error = %v", err)
	}
	if !result.Written() || result.TargetSheet != "2026-07" {
		t.Fatalf("result = %#v", result)
	}
	if len(api.batches) != 3 {
		t.Fatalf("batch count = %d, want setup create, metadata header, atomic append", len(api.batches))
	}
	create := api.batches[0]
	if len(create.Requests) != 2 || create.Requests[0].AddSheet.Title != "2026-07" || create.Requests[1].AddSheet.Title != "_money_bot_meta" || !create.Requests[1].AddSheet.Hidden {
		t.Fatalf("create batch = %#v", create)
	}
	headerBatch := api.batches[1]
	if len(headerBatch.Requests) != 1 || !reflect.DeepEqual(headerBatch.Requests[0].AppendCells.Values[0], MetadataHeaders) {
		t.Fatalf("metadata header batch = %#v", headerBatch)
	}
	appendBatch := api.batches[2]
	if len(appendBatch.Requests) != 2 || appendBatch.Requests[0].AppendCells == nil || appendBatch.Requests[1].AppendCells == nil {
		t.Fatalf("append batch = %#v", appendBatch)
	}
	wantRow := []string{"18/07/2026", "expense", "(food) ăn tối 150k pizza", "150000"}
	if !reflect.DeepEqual(appendBatch.Requests[0].AppendCells.Values, [][]string{wantRow}) {
		t.Fatalf("target rows = %#v, want %#v", appendBatch.Requests[0].AppendCells.Values, [][]string{wantRow})
	}
	if len(appendBatch.Requests[1].AppendCells.Values) != 1 || appendBatch.Requests[1].AppendCells.Values[0][1] != "99" || appendBatch.Requests[1].AppendCells.Values[0][3] != "2026-07" {
		t.Fatalf("metadata row = %#v", appendBatch.Requests[1].AppendCells.Values)
	}
}

func TestAppendTransactionUsesClockWhenTransactionDateIsZero(t *testing.T) {
	api := newFakeAPI()
	repo := mustRepo(t, api)
	repo.SetClock(func() time.Time { return time.Date(2026, 7, 18, 23, 0, 0, 0, time.UTC) })
	tx := domain.Transaction{Category: "Ăn", Amount: 1, Type: domain.TransactionExpense, SourceUpdateID: 101}

	result, err := repo.AppendTransaction(context.Background(), tx)
	if err != nil {
		t.Fatalf("AppendTransaction() error = %v", err)
	}
	if result.TargetSheet != "2026-07" {
		t.Fatalf("target sheet = %q", result.TargetSheet)
	}
	appendBatch := api.batches[len(api.batches)-1]
	if got := appendBatch.Requests[0].AppendCells.Values[0][0]; got != "19/07/2026" {
		t.Fatalf("row date = %q, want Vietnam-local 19/07/2026", got)
	}
}

func TestAppendTransactionSuppressesDuplicateUpdateID(t *testing.T) {
	api := newFakeAPI()
	api.spreadsheet.Sheets = []Sheet{{ID: 1, Title: "2026-07"}, {ID: 2, Title: "_money_bot_meta", Hidden: true}}
	api.values[quoteSheet("_money_bot_meta")+"!A1:E1"] = [][]string{MetadataHeaders}
	api.values[quoteSheet("_money_bot_meta")+"!A2:E"] = [][]string{{"1", "99", "2026-07-18T00:00:00Z", "2026-07", "written"}}
	repo := mustRepo(t, api)
	tx := domain.Transaction{Category: "Ăn", Amount: 1, Type: domain.TransactionExpense, Date: time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC), SourceUpdateID: 99}

	result, err := repo.AppendTransaction(context.Background(), tx)
	if err != nil {
		t.Fatalf("AppendTransaction() error = %v", err)
	}
	if !result.Duplicate() {
		t.Fatalf("result = %#v", result)
	}
	if len(api.batches) != 0 {
		t.Fatalf("unexpected batches = %#v", api.batches)
	}
}

func TestAppendTransactionRecoversAmbiguousWriteByMetadataCheck(t *testing.T) {
	api := newFakeAPI()
	api.spreadsheet.Sheets = []Sheet{{ID: 1, Title: "2026-07"}, {ID: 2, Title: "_money_bot_meta", Hidden: true}}
	api.values[quoteSheet("_money_bot_meta")+"!A1:E1"] = [][]string{MetadataHeaders}
	api.batchErrs = []error{AmbiguousError{Err: errors.New("eof")}}
	repo := mustRepo(t, api)
	tx := domain.Transaction{Category: "Ăn", Amount: 1, Type: domain.TransactionExpense, Date: time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC), SourceUpdateID: 100}

	result, err := repo.AppendTransaction(context.Background(), tx)
	if err != nil {
		t.Fatalf("AppendTransaction() error = %v", err)
	}
	if !result.Written() {
		t.Fatalf("result = %#v", result)
	}
	if len(api.batches) != 1 {
		t.Fatalf("ambiguous accepted write should not retry after metadata found, batches=%d", len(api.batches))
	}
}

func TestAppendTransactionDoesNotRetryPermanentBatchError(t *testing.T) {
	api := newFakeAPI()
	api.spreadsheet.Sheets = []Sheet{{ID: 1, Title: "2026-07"}, {ID: 2, Title: "_money_bot_meta", Hidden: true}}
	api.values[quoteSheet("_money_bot_meta")+"!A1:E1"] = [][]string{MetadataHeaders}
	api.batchErrs = []error{errors.New("permission denied")}
	repo := mustRepo(t, api)
	tx := domain.Transaction{Category: "Ăn", Amount: 1, Type: domain.TransactionExpense, Date: time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC), SourceUpdateID: 100}

	_, err := repo.AppendTransaction(context.Background(), tx)
	if err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("AppendTransaction() error = %v", err)
	}
	if len(api.batches) != 1 {
		t.Fatalf("permanent error retried, batches=%d", len(api.batches))
	}
}

func TestAppendTransactionRejectsMetadataHeaderMismatch(t *testing.T) {
	api := newFakeAPI()
	api.spreadsheet.Sheets = []Sheet{{ID: 1, Title: "2026-07"}, {ID: 2, Title: "_money_bot_meta", Hidden: true}}
	api.values[quoteSheet("_money_bot_meta")+"!A1:E1"] = [][]string{{"bad"}}
	repo := mustRepo(t, api)
	tx := domain.Transaction{Category: "Ăn", Amount: 1, Type: domain.TransactionExpense, Date: time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC), SourceUpdateID: 100}

	_, err := repo.AppendTransaction(context.Background(), tx)
	if err == nil || !strings.Contains(err.Error(), "header") {
		t.Fatalf("AppendTransaction() error = %v", err)
	}
}

func mustRepo(t *testing.T, api *fakeAPI) *Repository {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		t.Fatal(err)
	}
	repo, err := NewRepository(api, "sheet", "_money_bot_meta", loc)
	if err != nil {
		t.Fatal(err)
	}
	return repo
}
