package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/thaodangspace/money-bot/domain"
)

type fakeLedger struct {
	appendCalls  int
	appended     []domain.Transaction
	appendResult AppendResult
	appendErr    error
	summary      domain.MonthlySummary
	summaryErr   error
	summaryYear  int
	summaryMonth time.Month
}

func (f *fakeLedger) AppendTransaction(_ context.Context, tx domain.Transaction) (AppendResult, error) {
	f.appendCalls++
	f.appended = append(f.appended, tx)
	if f.appendErr != nil {
		return AppendResult{}, f.appendErr
	}
	if f.appendResult.Status == "" {
		return AppendResult{Status: AppendWritten, TargetSheet: "2026-07"}, nil
	}
	return f.appendResult, nil
}

func (f *fakeLedger) MonthlySummary(_ context.Context, year int, month time.Month) (domain.MonthlySummary, error) {
	f.summaryYear, f.summaryMonth = year, month
	if f.summaryErr != nil {
		return domain.MonthlySummary{}, f.summaryErr
	}
	return f.summary, nil
}

type fakeAI struct {
	parseCalls   int
	parseTx      domain.Transaction
	parseErr     error
	confirmCalls int
	summaryCalls int
}

func (f *fakeAI) ParseTransaction(context.Context, string) (domain.Transaction, error) {
	f.parseCalls++
	if f.parseErr != nil {
		return domain.Transaction{}, f.parseErr
	}
	if f.parseTx.Type == "" {
		return domain.Transaction{Type: domain.TransactionExpense, Category: "food", Note: "pizza", Amount: 150000}, nil
	}
	return f.parseTx, nil
}

func (f *fakeAI) Confirmation(context.Context, domain.Transaction, bool) (string, error) {
	f.confirmCalls++
	return "Ghi lại rồi nha ✨", nil
}

func (f *fakeAI) SummaryCommentary(context.Context, domain.MonthlySummary) (string, error) {
	f.summaryCalls++
	return "Ổn áp đó!", nil
}

func TestRecordAlwaysUsesAIAndCapturesClockOnce(t *testing.T) {
	ledger := &fakeLedger{}
	ai := &fakeAI{}
	clock := ClockFunc(func() time.Time { return time.Date(2026, 7, 18, 23, 0, 0, 0, time.UTC) })
	svc := mustService(t, ledger, ai, ai, clock)

	res, err := svc.Record(context.Background(), 42, "ăn tối 150k pizza")
	if err != nil {
		t.Fatalf("Record() error = %v", err)
	}
	if !res.Parsed || !res.UsedAI || res.Duplicate {
		t.Fatalf("result = %#v", res)
	}
	if ai.parseCalls != 1 || ai.confirmCalls != 1 {
		t.Fatalf("ai calls parse=%d confirm=%d", ai.parseCalls, ai.confirmCalls)
	}
	if ledger.appendCalls != 1 || len(ledger.appended) != 1 {
		t.Fatalf("ledger calls = %d appended=%#v", ledger.appendCalls, ledger.appended)
	}
	tx := ledger.appended[0]
	if tx.SourceUpdateID != 42 || tx.Date.Format("2006-01-02") != "2026-07-19" || tx.Content() != "(food) ăn tối 150k pizza" || tx.Amount != 150000 {
		t.Fatalf("tx = %#v", tx)
	}
	if !strings.Contains(res.Text, "✅ Đã lưu chi tiêu") || !strings.Contains(res.Text, "150.000 ₫") || !strings.Contains(res.Text, "Ghi lại rồi") {
		t.Fatalf("text = %q", res.Text)
	}
}

func TestRecordUsesAIForNaturalLanguage(t *testing.T) {
	ledger := &fakeLedger{}
	ai := &fakeAI{parseTx: domain.Transaction{Type: domain.TransactionExpense, Category: "food", Note: "pizza", Amount: 150000}}
	svc := mustService(t, ledger, ai, nil, fixedClock())

	res, err := svc.Record(context.Background(), 7, "tối qua pizza hết một trăm rưỡi")
	if err != nil {
		t.Fatalf("Record() error = %v", err)
	}
	if !res.Parsed || !res.UsedAI || ai.parseCalls != 1 || ledger.appendCalls != 1 {
		t.Fatalf("result=%#v aiCalls=%d ledgerCalls=%d", res, ai.parseCalls, ledger.appendCalls)
	}
	if !strings.Contains(res.Text, "AI đã hỗ trợ") {
		t.Fatalf("text = %q", res.Text)
	}
}

func TestRecordParseFailureReturnsUsageWithoutWrite(t *testing.T) {
	ledger := &fakeLedger{}
	ai := &fakeAI{parseErr: errors.New("invalid")}
	svc := mustService(t, ledger, ai, nil, fixedClock())

	res, err := svc.Record(context.Background(), 7, "không hiểu")
	if err != nil {
		t.Fatalf("Record() error = %v", err)
	}
	if res.Parsed || ledger.appendCalls != 0 || ai.parseCalls != 1 || !strings.Contains(res.Text, "ăn tối 150k") {
		t.Fatalf("result=%#v ledgerCalls=%d aiCalls=%d", res, ledger.appendCalls, ai.parseCalls)
	}
}

func TestRecordRejectsMissingUpdateIDWithoutWrite(t *testing.T) {
	ledger := &fakeLedger{}
	svc := mustService(t, ledger, &fakeAI{}, nil, fixedClock())
	res, err := svc.Record(context.Background(), 0, "ăn tối 150k")
	if err == nil || ledger.appendCalls != 0 || !strings.Contains(res.Text, "thiếu mã cập nhật") {
		t.Fatalf("result=%#v err=%v ledgerCalls=%d", res, err, ledger.appendCalls)
	}
}

func TestRecordDuplicateAndLedgerError(t *testing.T) {
	ledger := &fakeLedger{appendResult: AppendResult{Status: AppendDuplicate, TargetSheet: "2026-07"}}
	svc := mustService(t, ledger, &fakeAI{}, nil, fixedClock())
	res, err := svc.Record(context.Background(), 1, "ăn tối 150k")
	if err != nil || !res.Duplicate || !strings.Contains(res.Text, "đã được ghi") {
		t.Fatalf("duplicate result=%#v err=%v", res, err)
	}

	ledger = &fakeLedger{appendErr: errors.New("sheets down")}
	svc = mustService(t, ledger, &fakeAI{}, nil, fixedClock())
	res, err = svc.Record(context.Background(), 1, "ăn tối 150k")
	if err == nil || !strings.Contains(res.Text, "Không lưu được") || strings.Contains(res.Text, "✅") {
		t.Fatalf("error result=%#v err=%v", res, err)
	}
}

func TestIsSummaryIntent(t *testing.T) {
	svc := mustService(t, &fakeLedger{}, &fakeAI{}, nil, fixedClock())
	if !svc.IsSummaryIntent("chi tiêu tháng này") || svc.IsSummaryIntent("ăn tối 150k") {
		t.Fatal("summary intent mismatch")
	}
}

func mustService(t *testing.T, ledger Ledger, ai AIParser, comments Commentator, clock Clock) *Service {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	if err != nil {
		t.Fatal(err)
	}
	svc, err := New(Options{Location: loc, Clock: clock, Ledger: ledger, AI: ai, Comments: comments})
	if err != nil {
		t.Fatal(err)
	}
	return svc
}

func fixedClock() Clock {
	return ClockFunc(func() time.Time { return time.Date(2026, 7, 18, 10, 0, 0, 0, time.UTC) })
}
