package service

import (
	"strings"
	"testing"
	"time"

	"github.com/dtonair/money-bot/domain"
)

func TestFormatDong(t *testing.T) {
	tests := map[int64]string{0: "0", 1: "1", 1000: "1.000", 1500000: "1.500.000", -50000: "-50.000"}
	for input, want := range tests {
		if got := formatDong(input); got != want {
			t.Fatalf("formatDong(%d) = %q, want %q", input, got, want)
		}
	}
}

func TestVietnameseMonthName(t *testing.T) {
	if got := vietnameseMonthName(time.July); got != "tháng bảy" {
		t.Fatalf("month = %q", got)
	}
}

func TestBoundTextIsRuneSafe(t *testing.T) {
	got := boundText("😀😀😀", 2)
	if got != "😀…" {
		t.Fatalf("boundText() = %q", got)
	}
}

func TestSuccessAndDuplicateText(t *testing.T) {
	tx := domain.Transaction{Type: domain.TransactionIncome, Category: "Lương", Note: strings.Repeat("x", 400), Amount: 2000000}
	text := successText(tx, true)
	if !strings.Contains(text, "thu nhập") || !strings.Contains(text, "2.000.000 ₫") || !strings.Contains(text, "AI") || len([]rune(text)) > 420 {
		t.Fatalf("success text = %q", text)
	}
	dup := duplicateText(tx)
	if !strings.Contains(dup, "đã được ghi") || !strings.Contains(dup, "2.000.000 ₫") {
		t.Fatalf("duplicate text = %q", dup)
	}
}
