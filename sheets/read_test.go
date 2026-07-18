package sheets

import (
	"context"
	"testing"
	"time"
)

func TestMonthlySummaryCombinesFlatAndLegacyRows(t *testing.T) {
	api := newFakeAPI()
	api.values[quoteSheet("2026-07")+"!A:D"] = [][]string{
		{"18/07/2026", "expense", "Ăn tối pizza", "150000"},
		{"18/07/2026", "income", "Lương", "2000000"},
		{"17/06/2026", "expense", "old", "999"},
		{"18/07/2026", "bad", "bad", "1"},
		{"18/07/2026", "expense", "bad", "not-number"},
	}
	api.values[quoteSheet("7")+"!A2:D"] = [][]string{
		{"01/07/2026", "", "", ""},
		{"Cà phê", "50.000", "", ""},
		{"Thưởng", "", "1,000,000", ""},
		{"01/07/2025", "", "", ""},
		{"Old", "100000", "", ""},
		{"", "", "", ""},
	}
	repo := mustRepo(t, api)

	summary, err := repo.MonthlySummary(context.Background(), 2026, time.July)
	if err != nil {
		t.Fatalf("MonthlySummary() error = %v", err)
	}
	if summary.TotalExpenses != 200000 || summary.TotalIncome != 3000000 || summary.Balance != 2800000 || summary.EntryCount != 4 {
		t.Fatalf("summary = %#v", summary)
	}
}

func TestMonthlySummaryTreatsMissingSheetsAsEmpty(t *testing.T) {
	repo := mustRepo(t, newFakeAPI())
	summary, err := repo.MonthlySummary(context.Background(), 2026, time.July)
	if err != nil {
		t.Fatalf("MonthlySummary() error = %v", err)
	}
	if summary.TotalExpenses != 0 || summary.TotalIncome != 0 || summary.Balance != 0 || summary.EntryCount != 0 {
		t.Fatalf("summary = %#v", summary)
	}
}

func TestValidateFlatRow(t *testing.T) {
	if err := validateFlatRow([]string{"18/07/2026", "expense", "Ăn", "150000"}); err != nil {
		t.Fatalf("validateFlatRow() error = %v", err)
	}
	for _, row := range [][]string{
		{"18/07/2026", "bad", "Ăn", "150000"},
		{"18/07/2026", "expense", "Ăn", "bad"},
		{"bad", "expense", "Ăn", "150000"},
		{"18/07/2026", "expense"},
	} {
		if err := validateFlatRow(row); err == nil {
			t.Fatalf("validateFlatRow(%#v) error = nil", row)
		}
	}
}
