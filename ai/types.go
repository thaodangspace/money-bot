package ai

import (
	"context"
	"errors"

	"github.com/dtonair/money-bot/domain"
)

var (
	ErrUnavailable   = errors.New("ai unavailable")
	ErrInvalidOutput = errors.New("ai invalid output")
)

type TransactionParser interface {
	ParseTransaction(ctx context.Context, message string) (domain.Transaction, error)
}

type Commentator interface {
	Confirmation(ctx context.Context, tx domain.Transaction, usedAI bool) (string, error)
	SummaryCommentary(ctx context.Context, summary domain.MonthlySummary) (string, error)
}
