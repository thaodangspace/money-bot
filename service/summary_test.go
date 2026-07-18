package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/dtonair/money-bot/domain"
)

func TestSummaryFormatsLedgerTotalsAndCommentary(t *testing.T) {
	ledger := &fakeLedger{summary: domain.NewMonthlySummary(2026, time.July, 150000, 2000000, 3)}
	ai := &fakeAI{}
	svc := mustService(t, ledger, ai, ai, fixedClock())

	res, err := svc.Summary(context.Background(), "")
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if ledger.summaryYear != 2026 || ledger.summaryMonth != time.July {
		t.Fatalf("ledger requested %d %s", ledger.summaryYear, ledger.summaryMonth)
	}
	for _, want := range []string{"📊 Báo cáo tháng bảy 2026", "💸 Tổng chi tiêu: 150.000 ₫", "💰 Tổng thu nhập: 2.000.000 ₫", "⚖️ Cân bằng: 1.850.000 ₫", "📝 Số giao dịch: 3", "Ổn áp"} {
		if !strings.Contains(res.Text, want) {
			t.Fatalf("summary text missing %q:\n%s", want, res.Text)
		}
	}
	if strings.Contains(strings.ToLower(res.Text), "danh mục") {
		t.Fatalf("summary unexpectedly contains category breakdown: %s", res.Text)
	}
	if ai.summaryCalls != 1 {
		t.Fatalf("summary commentary calls = %d", ai.summaryCalls)
	}
}

func TestSummaryEmptyMonth(t *testing.T) {
	ledger := &fakeLedger{summary: domain.NewMonthlySummary(2026, time.July, 0, 0, 0)}
	svc := mustService(t, ledger, &fakeAI{}, nil, fixedClock())
	res, err := svc.Summary(context.Background(), "")
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if !strings.Contains(res.Text, "Chưa có dữ liệu") {
		t.Fatalf("summary = %q", res.Text)
	}
}

func TestSummaryAcceptsExplicitMonth(t *testing.T) {
	ledger := &fakeLedger{summary: domain.NewMonthlySummary(2026, time.May, 100000, 0, 1)}
	svc := mustService(t, ledger, &fakeAI{}, nil, fixedClock())
	res, err := svc.Summary(context.Background(), "tháng 5")
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if ledger.summaryYear != 2026 || ledger.summaryMonth != time.May {
		t.Fatalf("ledger requested %d %s", ledger.summaryYear, ledger.summaryMonth)
	}
	if !strings.Contains(res.Text, "📊 Báo cáo tháng năm 2026") {
		t.Fatalf("summary = %q", res.Text)
	}
}

func TestSummaryInvalidMonthUsage(t *testing.T) {
	ledger := &fakeLedger{}
	svc := mustService(t, ledger, &fakeAI{}, nil, fixedClock())
	res, err := svc.Summary(context.Background(), "tháng 13")
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if ledger.summaryYear != 0 || !strings.Contains(res.Text, "chưa hiểu tháng") {
		t.Fatalf("result=%#v ledger=%#v", res, ledger)
	}
}

func TestSummaryLedgerError(t *testing.T) {
	ledger := &fakeLedger{summaryErr: errors.New("sheets down")}
	svc := mustService(t, ledger, &fakeAI{}, nil, fixedClock())
	res, err := svc.Summary(context.Background(), "")
	if err == nil || !strings.Contains(res.Text, "Không đọc được") {
		t.Fatalf("result=%#v err=%v", res, err)
	}
}
