package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/thaodangspace/money-bot/ai"
	"github.com/thaodangspace/money-bot/domain"
)

type batchTestAI struct{}

func (batchTestAI) ParseTransaction(context.Context, string) (domain.Transaction, error) {
	return domain.Transaction{}, nil
}

func (batchTestAI) ParseImageTransactions(context.Context, string, string, []byte) (ai.ImageTransactionExtraction, error) {
	date := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	return ai.ImageTransactionExtraction{
		Kind:     ai.ImageExtractionList,
		Detected: 3,
		Transactions: []domain.Transaction{
			{Type: domain.TransactionExpense, Category: "drink", Note: "Cafe", Amount: 50000, Date: date},
			{Type: domain.TransactionExpense, Category: "transport", Note: "Fuel", Amount: 120000, Date: date},
			{Type: domain.TransactionExpense, Category: "food", Note: "Lunch", Amount: 75000, Date: date},
		},
	}, nil
}

type batchTestLedger struct {
	transactions []domain.Transaction
	updates      []int
}

type summaryOnlyLedger struct{}

func (summaryOnlyLedger) MonthlySummary(context.Context, int, time.Month) (domain.MonthlySummary, error) {
	return domain.MonthlySummary{}, nil
}

type textOnlyAI struct{}

func (textOnlyAI) ParseTransaction(context.Context, string) (domain.Transaction, error) {
	return domain.Transaction{}, nil
}

func (l *batchTestLedger) AppendTransactions(_ context.Context, updateID int, transactions []domain.Transaction) (AppendBatchResult, error) {
	l.updates = append(l.updates, updateID)
	l.transactions = append(l.transactions, transactions...)
	return AppendBatchResult{Status: AppendWritten}, nil
}

func (l *batchTestLedger) MonthlySummary(context.Context, int, time.Month) (domain.MonthlySummary, error) {
	return domain.MonthlySummary{}, nil
}

func TestNewRequiresWriteAndImageCapabilities(t *testing.T) {
	if _, err := New(Options{Ledger: summaryOnlyLedger{}, AI: batchTestAI{}, Location: time.UTC}); err == nil {
		t.Fatal("service accepted ledger without append capability")
	}
	if _, err := New(Options{Ledger: &batchTestLedger{}, AI: textOnlyAI{}, Location: time.UTC}); err == nil {
		t.Fatal("service accepted AI without image capability")
	}
}

func TestImageBatchPreviewAndConfirmationWritesAllTransactions(t *testing.T) {
	ledger := &batchTestLedger{}
	svc := mustService(t, ledger, batchTestAI{}, nil, fixedClock())
	prepared, err := svc.PrepareImage(context.Background(), 77, ImageInput{MIMEType: "image/png", Data: []byte{1}})
	if err != nil || prepared.Token == "" {
		t.Fatalf("prepared=%#v err=%v", prepared, err)
	}
	if len(ledger.transactions) != 0 || !strings.Contains(prepared.Text, "3 giao dịch") || !strings.Contains(prepared.Text, "1. 18/07/2026 · Chi tiêu") || !strings.Contains(prepared.Text, "Tổng chi tiêu: 245.000") {
		t.Fatalf("preview=%q writes=%#v", prepared.Text, ledger.transactions)
	}
	result, err := svc.ConfirmImage(context.Background(), prepared.Token)
	if err != nil || !result.Parsed || len(ledger.transactions) != 3 || len(ledger.updates) != 1 {
		t.Fatalf("result=%#v err=%v ledger=%#v", result, err, ledger)
	}
	for _, tx := range ledger.transactions {
		if tx.SourceUpdateID != 77 || tx.Date.IsZero() {
			t.Fatalf("transaction=%#v", tx)
		}
	}
}
