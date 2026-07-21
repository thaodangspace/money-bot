package service

import (
	"context"
	"strings"

	"github.com/thaodangspace/money-bot/parser"
)

func (s *Service) Summary(ctx context.Context, query string) (Result, error) {
	now := s.clock.Now().In(s.location)
	period, ok := parser.ParseMonthlySummaryPeriod(query, now)
	if !ok {
		return Result{Text: summaryUsageText()}, nil
	}
	summary, err := s.ledger.MonthlySummary(ctx, period.Year, period.Month)
	if err != nil {
		return Result{Text: "❌ Không đọc được báo cáo từ Google Sheet. Vui lòng thử lại sau."}, err
	}
	out := formatSummary(summary)
	if s.comments != nil {
		if comment, err := s.comments.SummaryCommentary(ctx, summary); err == nil && strings.TrimSpace(comment) != "" {
			out += "\n" + boundText(strings.TrimSpace(comment), 320)
		}
	}
	return Result{Text: out}, nil
}
