package service

import (
	"context"
	"time"

	"github.com/thaodangspace/money-bot/ai"
	"github.com/thaodangspace/money-bot/domain"
)

type AppendStatus = domain.AppendStatus

const (
	AppendWritten   = domain.AppendWritten
	AppendDuplicate = domain.AppendDuplicate
)

type AppendResult = domain.AppendBatchResult
type AppendBatchResult = domain.AppendBatchResult

// Ledger is intentionally small so the service can support both the batch API
// and older single-transaction fakes during migration.
type Ledger interface {
	MonthlySummary(ctx context.Context, year int, month time.Month) (domain.MonthlySummary, error)
}

type AIParser interface {
	ParseTransaction(ctx context.Context, message string) (domain.Transaction, error)
}

type imageBatchParser interface {
	ParseImageTransactions(ctx context.Context, caption, mimeType string, image []byte) (ai.ImageTransactionExtraction, error)
}

type imageSingleParser interface {
	ParseImageTransaction(ctx context.Context, caption, mimeType string, image []byte) (domain.Transaction, error)
}

type batchLedger interface {
	AppendTransactions(ctx context.Context, updateID int, transactions []domain.Transaction) (AppendBatchResult, error)
}

type singleLedger interface {
	AppendTransaction(ctx context.Context, tx domain.Transaction) (AppendResult, error)
}

type ImageInput struct {
	Caption  string
	MIMEType string
	Data     []byte
}

type ImagePreparation struct {
	Text  string
	Token string
}

type Commentator interface {
	Confirmation(ctx context.Context, tx domain.Transaction, usedAI bool) (string, error)
	SummaryCommentary(ctx context.Context, summary domain.MonthlySummary) (string, error)
}

type Clock interface {
	Now() time.Time
}

type ClockFunc func() time.Time

func (f ClockFunc) Now() time.Time { return f() }

type Options struct {
	Location *time.Location
	Clock    Clock
	Ledger   Ledger
	AI       AIParser
	Comments Commentator
}

type Result struct {
	Text      string
	Parsed    bool
	UsedAI    bool
	Duplicate bool
}
