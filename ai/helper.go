package ai

import (
	"context"

	"github.com/thaodangspace/money-bot/domain"
)

type Optional struct {
	Parser     TransactionParser
	Commentary Commentator
}

func (o Optional) ParseTransaction(ctx context.Context, message string) (domain.Transaction, error) {
	if o.Parser == nil {
		return domain.Transaction{}, ErrUnavailable
	}
	return o.Parser.ParseTransaction(ctx, message)
}

func (o Optional) Confirmation(ctx context.Context, tx domain.Transaction, usedAI bool) (string, error) {
	if o.Commentary == nil {
		return "", ErrUnavailable
	}
	return o.Commentary.Confirmation(ctx, tx, usedAI)
}

func (o Optional) SummaryCommentary(ctx context.Context, summary domain.MonthlySummary) (string, error) {
	if o.Commentary == nil {
		return "", ErrUnavailable
	}
	return o.Commentary.SummaryCommentary(ctx, summary)
}
