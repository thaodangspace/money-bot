package ai

import (
	"strings"
	"testing"
)

func TestParseImageTransactionsJSONAcceptsReceiptAndList(t *testing.T) {
	receipt, err := ParseImageTransactionsJSON(`{"kind":"single_receipt","detected":1,"transactions":[{"type":"expense","category":"food","amount":150000,"note":"Cafe"}]}`)
	if err != nil || receipt.Kind != ImageExtractionSingleReceipt || len(receipt.Transactions) != 1 {
		t.Fatalf("receipt=%#v err=%v", receipt, err)
	}
	list, err := ParseImageTransactionsJSON(`{"kind":"transaction_list","detected":2,"transactions":[{"type":"expense","category":"drink","amount":50000,"note":"Cafe","date":"2026-08-01"},{"type":"income","category":"salary","amount":2000000,"note":"Pay"}]}`)
	if err != nil || list.Kind != ImageExtractionList || list.Detected != 2 || len(list.Transactions) != 2 {
		t.Fatalf("list=%#v err=%v", list, err)
	}
	if list.Transactions[0].Date.IsZero() {
		t.Fatal("explicit date was lost")
	}
	if !list.Transactions[1].Date.IsZero() {
		t.Fatalf("absent date = %v, want zero", list.Transactions[1].Date)
	}
}

func TestParseImageTransactionsJSONRejectsUnsafeOrIncompleteOutput(t *testing.T) {
	base := `"transactions":[{"type":"expense","category":"food","amount":1,"note":"x"}]`
	cases := []string{
		`{"kind":"transaction_list","detected":2,` + base + `}`,
		`{"kind":"transaction_list","detected":1,` + base + `,"extra":true}`,
		`{"kind":"transaction_list","detected":1,` + base + `{"type":"expense","category":"food","amount":1,"note":"x"}]}`,
		`{"kind":"single_receipt","detected":1,"transactions":[{"type":"expense","category":"food","amount":1.5,"note":"x"}]}`,
		"```json\n{\"kind\":\"single_receipt\",\"detected\":1,\"transactions\":[{\"type\":\"expense\",\"category\":\"food\",\"amount\":1,\"note\":\"x\"}]}\n```",
	}
	for _, input := range cases {
		if _, err := ParseImageTransactionsJSON(input); err == nil {
			t.Fatalf("accepted invalid output: %s", input)
		}
	}
	duplicate := `{"kind":"transaction_list","detected":2,"transactions":[{"type":"expense","category":"food","amount":1,"note":"x"},{"type":"expense","category":"food","amount":1,"note":"x"}]}`
	if _, err := ParseImageTransactionsJSON(duplicate); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate err=%v", err)
	}
}
