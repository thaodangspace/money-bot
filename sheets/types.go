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

type AppendStatus = domain.AppendStatus

const (
	AppendWritten   = domain.AppendWritten
	AppendDuplicate = domain.AppendDuplicate
)

type AppendBatchResult = domain.AppendBatchResult
type AppendResult = domain.AppendBatchResult

type Repository struct {
	api           API
	spreadsheetID string
	metadataSheet string
	location      *time.Location
	maxRetries    int
	now           func() time.Time
}

type Ledger interface {
	AppendTransactions(ctx context.Context, updateID int, transactions []domain.Transaction) (AppendBatchResult, error)
	MonthlySummary(ctx context.Context, year int, month time.Month) (domain.MonthlySummary, error)
}
