package sheets

import (
	"context"
	"errors"
	"time"

	"github.com/thaodangspace/money-bot/domain"
)

var ErrSheetNotFound = errors.New("sheet not found")

const (
	MetadataSchemaVersion = "1"
	MetadataHeaderVersion = "Schema Version"
	MetadataHeaderUpdate  = "Update ID"
	MetadataHeaderAt      = "Processed At"
	MetadataHeaderSheet   = "Target Sheet"
	MetadataHeaderOutcome = "Outcome"
)

var MetadataHeaders = []string{MetadataHeaderVersion, MetadataHeaderUpdate, MetadataHeaderAt, MetadataHeaderSheet, MetadataHeaderOutcome}

type API interface {
	GetSpreadsheet(ctx context.Context, spreadsheetID string) (Spreadsheet, error)
	GetValues(ctx context.Context, spreadsheetID, readRange string) ([][]string, error)
	BatchUpdate(ctx context.Context, spreadsheetID string, req BatchUpdateRequest) error
}

type Spreadsheet struct {
	Sheets []Sheet
}

type Sheet struct {
	ID     int64
	Title  string
	Hidden bool
}

type BatchUpdateRequest struct {
	Requests []Request
}

type Request struct {
	AddSheet              *AddSheetRequest
	UpdateSheetProperties *UpdateSheetPropertiesRequest
	AppendCells           *AppendCellsRequest
}

type AddSheetRequest struct {
	Title  string
	Hidden bool
}

type UpdateSheetPropertiesRequest struct {
	SheetID int64
	Hidden  bool
}

type AppendCellsRequest struct {
	SheetID    int64
	SheetTitle string
	Values     [][]string
}

type AppendStatus string

const (
	AppendWritten   AppendStatus = "written"
	AppendDuplicate AppendStatus = "duplicate"
)

type AppendResult struct {
	Status      AppendStatus
	TargetSheet string
}

func (r AppendResult) Written() bool   { return r.Status == AppendWritten }
func (r AppendResult) Duplicate() bool { return r.Status == AppendDuplicate }

type Repository struct {
	api           API
	spreadsheetID string
	metadataSheet string
	location      *time.Location
	maxRetries    int
	now           func() time.Time
}

type Ledger interface {
	AppendTransaction(ctx context.Context, tx domain.Transaction) (AppendResult, error)
	MonthlySummary(ctx context.Context, year int, month time.Month) (domain.MonthlySummary, error)
}
