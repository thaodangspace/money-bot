package service

import (
	"context"
	"time"

	"github.com/thaodangspace/money-bot/domain"
)

type AppendStatus string

const (
	AppendWritten   AppendStatus = "written"
	AppendDuplicate AppendStatus = "duplicate"
)

type AppendResult struct {
	Status      AppendStatus
	TargetSheet string
}

type Ledger interface {
	AppendTransaction(ctx context.Context, tx domain.Transaction) (AppendResult, error)
	MonthlySummary(ctx context.Context, year int, month time.Month) (domain.MonthlySummary, error)
}

type AIParser interface {
	ParseTransaction(ctx context.Context, message string) (domain.Transaction, error)
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
