package parser

import (
	"testing"
	"time"
)

func TestParseMonthlySummaryPeriod(t *testing.T) {
	now := time.Date(2026, time.July, 18, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		input string
		year  int
		month time.Month
	}{
		{"", 2026, time.July},
		{"tháng này", 2026, time.July},
		{"tháng trước", 2026, time.June},
		{"tháng 5", 2026, time.May},
		{"thang 05", 2026, time.May},
		{"tháng 5/2025", 2025, time.May},
		{"05/2025", 2025, time.May},
		{"2025-05", 2025, time.May},
		{"/summary tháng 5", 2026, time.May},
		{"chi tiêu tháng 5", 2026, time.May},
	}
	for _, tt := range tests {
		period, ok := ParseMonthlySummaryPeriod(tt.input, now)
		if !ok || period.Year != tt.year || period.Month != tt.month {
			t.Fatalf("ParseMonthlySummaryPeriod(%q) = %#v, %v; want %d %s", tt.input, period, ok, tt.year, tt.month)
		}
	}
}

func TestParseMonthlySummaryPeriodInvalid(t *testing.T) {
	now := time.Date(2026, time.July, 18, 10, 0, 0, 0, time.UTC)
	for _, input := range []string{"tháng 13", "foo", "2025-13"} {
		if period, ok := ParseMonthlySummaryPeriod(input, now); ok {
			t.Fatalf("ParseMonthlySummaryPeriod(%q) = %#v, true", input, period)
		}
	}
}
