package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/thaodangspace/money-bot/domain"
	"github.com/thaodangspace/money-bot/parser"
)

type Service struct {
	location *time.Location
	clock    Clock
	ledger   Ledger
	ai       AIParser
	comments Commentator
}

func New(opts Options) (*Service, error) {
	if opts.Ledger == nil {
		return nil, errors.New("ledger is required")
	}
	if opts.AI == nil {
		return nil, errors.New("ai parser is required")
	}
	loc := opts.Location
	if loc == nil {
		loc = time.UTC
	}
	clock := opts.Clock
	if clock == nil {
		clock = ClockFunc(time.Now)
	}
	return &Service{location: loc, clock: clock, ledger: opts.Ledger, ai: opts.AI, comments: opts.Comments}, nil
}

func (s *Service) IsSummaryIntent(text string) bool {
	return parser.DetectMonthlySummaryIntent(text)
}

func (s *Service) Record(ctx context.Context, updateID int, text string) (Result, error) {
	if updateID <= 0 {
		return Result{Text: "❌ Không thể lưu giao dịch vì thiếu mã cập nhật Telegram. Vui lòng thử lại."}, fmt.Errorf("telegram update ID is required")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return Result{Text: usageText()}, nil
	}
	now := s.clock.Now().In(s.location)
	tx, usedAI, ok := s.parseTransaction(ctx, text)
	if !ok {
		return Result{Text: usageText()}, nil
	}
	tx.Date = now
	tx.SourceUpdateID = updateID
	tx.OriginalMessage = text
	appendResult, err := s.ledger.AppendTransaction(ctx, tx)
	if err != nil {
		return Result{Parsed: true, UsedAI: usedAI, Text: "❌ Không lưu được giao dịch vào Google Sheet. Vui lòng thử lại sau."}, err
	}
	if appendResult.Status == AppendDuplicate {
		return Result{Parsed: true, UsedAI: usedAI, Duplicate: true, Text: duplicateText(tx)}, nil
	}
	out := successText(tx, usedAI)
	if s.comments != nil {
		if comment, err := s.comments.Confirmation(ctx, tx, usedAI); err == nil && strings.TrimSpace(comment) != "" {
			out += "\n" + boundText(strings.TrimSpace(comment), 240)
		}
	}
	return Result{Parsed: true, UsedAI: usedAI, Text: out}, nil
}

func (s *Service) parseTransaction(ctx context.Context, text string) (domain.Transaction, bool, bool) {
	if s.ai == nil {
		return domain.Transaction{}, false, false
	}
	tx, err := s.ai.ParseTransaction(ctx, text)
	if err != nil {
		return domain.Transaction{}, false, false
	}
	if err := tx.Validate(); err != nil {
		return domain.Transaction{}, false, false
	}
	return tx, true, true
}
