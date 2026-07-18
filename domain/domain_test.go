package domain

import (
	"strings"
	"testing"
	"time"
)

func TestTransactionContentUsesOriginalMessageWithCategoryTag(t *testing.T) {
	tx := Transaction{Category: " food ", Note: " pizza ", OriginalMessage: " ăn tối  150k ", Amount: 150000, Type: TransactionExpense}
	if got := tx.Content(); got != "(food) ăn tối 150k" {
		t.Fatalf("Content() = %q", got)
	}
}

func TestTransactionContentFallsBackToCategoryAndNote(t *testing.T) {
	tx := Transaction{Category: " Ăn tối ", Note: " pizza ", Amount: 150000, Type: TransactionExpense}
	if got := tx.Content(); got != "Ăn tối pizza" {
		t.Fatalf("Content() = %q", got)
	}
}

func TestTransactionValidate(t *testing.T) {
	valid := Transaction{Category: "Lương", Amount: 20_000_000, Type: TransactionIncome}
	if err := valid.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	invalid := Transaction{Category: " ", Amount: 0, Type: TransactionType("bad")}
	err := invalid.Validate()
	if err == nil {
		t.Fatal("Validate() error = nil")
	}
	for _, want := range []string{"transaction type", "category", "amount"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("Validate() error %q missing %q", err, want)
		}
	}
}

func TestMonthlySummaryComputesBalance(t *testing.T) {
	s := NewMonthlySummary(2026, time.July, 150000, 200000, 2)
	if s.Balance != 50000 || s.EntryCount != 2 || s.Year != 2026 || s.Month != time.July {
		t.Fatalf("summary = %#v", s)
	}
}
