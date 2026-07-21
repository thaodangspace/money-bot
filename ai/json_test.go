package ai

import (
	"strings"
	"testing"

	"github.com/thaodangspace/money-bot/domain"
)

func TestParseTransactionJSONAcceptsBareAndFencedObject(t *testing.T) {
	for _, input := range []string{
		`{"type":"expense","category":"Ăn tối","amount":150000,"note":"pizza"}`,
		"```json\n{\"type\":\"income\",\"category\":\"Lương\",\"amount\":2000000}\n```",
	} {
		tx, err := ParseTransactionJSON(input)
		if err != nil {
			t.Fatalf("ParseTransactionJSON(%q) error = %v", input, err)
		}
		if tx.Amount <= 0 || tx.Category == "" || !tx.Type.Valid() {
			t.Fatalf("tx = %#v", tx)
		}
	}
}

func TestParseTransactionJSONStrictValidation(t *testing.T) {
	cases := []string{
		`no json`,
		`{"type":"expense","category":"Ăn","amount":1}{"type":"expense","category":"Ăn","amount":1}`,
		`{"error":"unknown"}`,
		`{"type":"bad","category":"Ăn","amount":1}`,
		`{"type":"expense","amount":1}`,
		`{"type":"expense","category":"Ăn","amount":0}`,
		`{"type":"expense","category":"Ăn","amount":1.5}`,
		`{"type":"expense","category":"Ăn","amount":1,"extra":true}`,
		`{"type":"expense","category":"` + strings.Repeat("x", maxAICategoryRunes+1) + `","amount":1}`,
	}
	for _, input := range cases {
		if tx, err := ParseTransactionJSON(input); err == nil {
			t.Fatalf("ParseTransactionJSON(%q) = %#v, nil error", input, tx)
		}
	}
}

func TestParseTransactionJSONNormalizesText(t *testing.T) {
	tx, err := ParseTransactionJSON(`{"type":"expense","category":" ăn   tối ","amount":150000,"note":" pizza   ngon "}`)
	if err != nil {
		t.Fatal(err)
	}
	if tx.Type != domain.TransactionExpense || tx.Category != "ăn tối" || tx.Note != "pizza ngon" || tx.Content() != "ăn tối pizza ngon" {
		t.Fatalf("tx = %#v content=%q", tx, tx.Content())
	}
}
