package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/thaodangspace/money-bot/domain"
)

func TestCommentaryReturnsBoundedTextWithoutOwningNumbers(t *testing.T) {
	long := strings.Repeat("vui ", 200)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"` + long + `"}}]}`))
	}))
	defer server.Close()
	client, err := NewOpenRouter(Config{APIKey: "key", Model: "model", BaseURL: server.URL, RequestTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	confirmation, err := client.Confirmation(context.Background(), domain.Transaction{Type: domain.TransactionExpense, Category: "Ăn", Amount: 150000}, true)
	if err != nil {
		t.Fatalf("Confirmation() error = %v", err)
	}
	if len([]rune(confirmation)) > 240 {
		t.Fatalf("confirmation length = %d", len([]rune(confirmation)))
	}
}

func TestSummaryCommentaryIsOnlyCommentary(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Nhìn chung tháng này khá ổn 😊"}}]}`))
	}))
	defer server.Close()
	client, err := NewOpenRouter(Config{APIKey: "key", Model: "model", BaseURL: server.URL, RequestTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	comment, err := client.SummaryCommentary(context.Background(), domain.NewMonthlySummary(2026, time.July, 100, 200, 2))
	if err != nil {
		t.Fatalf("SummaryCommentary() error = %v", err)
	}
	if comment != "Nhìn chung tháng này khá ổn 😊" {
		t.Fatalf("comment = %q", comment)
	}
}
