package ai

import (
	"context"
	"errors"

	"github.com/thaodangspace/money-bot/domain"
)

var (
	ErrUnavailable   = errors.New("ai unavailable")
	ErrInvalidOutput = errors.New("ai invalid output")
)

type TransactionParser interface {
	ParseTransaction(ctx context.Context, message string) (domain.Transaction, error)
}

const MaxImageTransactions = 20

type ImageExtractionKind string

const (
	ImageExtractionSingleReceipt  ImageExtractionKind = "single_receipt"
	ImageExtractionSingleTransfer ImageExtractionKind = "single_transfer"
	ImageExtractionList           ImageExtractionKind = "transaction_list"
)

type ImageTransactionExtraction struct {
	Kind         ImageExtractionKind
	Transactions []domain.Transaction
	Detected     int
}

type ImageTransactionParser interface {
	ParseImageTransactions(ctx context.Context, caption, mimeType string, image []byte) (ImageTransactionExtraction, error)
}

type Commentator interface {
	Confirmation(ctx context.Context, tx domain.Transaction, usedAI bool) (string, error)
	SummaryCommentary(ctx context.Context, summary domain.MonthlySummary) (string, error)
}
