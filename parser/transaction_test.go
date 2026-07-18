package parser

import (
	"strings"
	"testing"

	"github.com/dtonair/money-bot/domain"
)

func TestParseTransactionValid(t *testing.T) {
	tests := []struct {
		input    string
		category string
		note     string
		amount   int64
		typ      domain.TransactionType
		content  string
	}{
		{input: "ăn tối 150k pizza", category: "Ăn tối", note: "pizza", amount: 150000, typ: domain.TransactionExpense, content: "Ăn tối pizza"},
		{input: "mua sắm 200000", category: "Mua sắm", amount: 200000, typ: domain.TransactionExpense, content: "Mua sắm"},
		{input: "thu lương 20tr tháng 7", category: "Lương", note: "tháng 7", amount: 20000000, typ: domain.TransactionIncome, content: "Lương tháng 7"},
		{input: "nhận thưởng 2tr", category: "Thưởng", amount: 2000000, typ: domain.TransactionIncome, content: "Thưởng"},
		{input: "nhan thuong 2tr vui", category: "Thuong", note: "vui", amount: 2000000, typ: domain.TransactionIncome, content: "Thuong vui"},
		{input: "cà phê 2k5", category: "Cà phê", amount: 2500, typ: domain.TransactionExpense, content: "Cà phê"},
		{input: "bán xe 144tr300 cũ", category: "Bán xe", note: "cũ", amount: 144300000, typ: domain.TransactionExpense, content: "Bán xe cũ"},
		{input: "thu nhập phụ 1,5tr freelance", category: "Phụ", note: "freelance", amount: 1500000, typ: domain.TransactionIncome, content: "Phụ freelance"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := ParseTransaction(tt.input)
			if err != nil {
				t.Fatalf("ParseTransaction() error = %v", err)
			}
			if got.Category != tt.category || got.Note != tt.note || got.Amount != tt.amount || got.Type != tt.typ || got.Content() != tt.content {
				t.Fatalf("ParseTransaction() = %#v, content=%q", got, got.Content())
			}
		})
	}
}

func TestParseTransactionInvalid(t *testing.T) {
	longCategory := strings.Repeat("x", MaxCategoryRunes+1)
	longNote := strings.Repeat("x", MaxNoteRunes+1)
	longInput := strings.Repeat("x", MaxInputRunes+1)
	for _, input := range []string{
		"", "150k", "ăn tối", "ăn tối 0", "ăn tối -1", "ăn tối 1,5", "ăn tối 2k1234", longInput, longCategory + " 1k", "ăn 1k " + longNote,
	} {
		if got, err := ParseTransaction(input); err == nil {
			t.Fatalf("ParseTransaction(%q) = %#v, nil error", input, got)
		}
	}
}

func TestParseTransactionWhitespaceAndCapitalization(t *testing.T) {
	got, err := ParseTransaction("  ăn    sáng   35k    bánh mì  ")
	if err != nil {
		t.Fatal(err)
	}
	if got.Category != "Ăn sáng" || got.Note != "bánh mì" || got.Amount != 35000 {
		t.Fatalf("got = %#v", got)
	}
}
