package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOpenRouterParseTransactionRequestAndHeaders(t *testing.T) {
	var gotAuth, gotReferer, gotTitle string
	var gotReq chatRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		gotReferer = r.Header.Get("HTTP-Referer")
		gotTitle = r.Header.Get("X-Title")
		if err := json.NewDecoder(r.Body).Decode(&gotReq); err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"type\":\"expense\",\"category\":\"Ăn tối\",\"amount\":150000,\"note\":\"pizza\"}"}}]}`))
	}))
	defer server.Close()
	client, err := NewOpenRouter(Config{APIKey: "secret-key", Model: "model-x", BaseURL: server.URL, Referer: "https://example.com", AppName: "money-bot", RequestTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := client.ParseTransaction(context.Background(), "ăn tối 150k pizza")
	if err != nil {
		t.Fatalf("ParseTransaction() error = %v", err)
	}
	if tx.Amount != 150000 || tx.Category != "Ăn tối" || tx.Note != "pizza" {
		t.Fatalf("tx = %#v", tx)
	}
	if gotAuth != "Bearer secret-key" || gotReferer != "https://example.com" || gotTitle != "money-bot" {
		t.Fatalf("headers auth=%q referer=%q title=%q", gotAuth, gotReferer, gotTitle)
	}
	if gotReq.Model != "model-x" || len(gotReq.Messages) != 2 || gotReq.Messages[0].Role != "system" || gotReq.Messages[1].Role != "user" {
		t.Fatalf("request = %#v", gotReq)
	}
}

func TestLMStudioCompatibleRequestDoesNotRequireAuthorization(t *testing.T) {
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"type\":\"expense\",\"category\":\"Ăn tối\",\"amount\":1500000,\"note\":\"pizza\"}"}}]}`))
	}))
	defer server.Close()
	client, err := NewClient(Config{Provider: "lmstudio", Model: "local-model", BaseURL: server.URL, RequestTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := client.ParseTransaction(context.Background(), "ăn tối 1tr5 pizza")
	if err != nil {
		t.Fatalf("ParseTransaction() error = %v", err)
	}
	if gotAuth != "" || tx.Amount != 1500000 {
		t.Fatalf("auth=%q tx=%#v", gotAuth, tx)
	}
}

func TestOpenRouterErrorsDoNotLeakAuthorization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "denied", http.StatusUnauthorized)
	}))
	defer server.Close()
	client, err := NewOpenRouter(Config{APIKey: "super-secret", Model: "model", BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.ParseTransaction(context.Background(), "bad")
	if err == nil {
		t.Fatal("ParseTransaction() error = nil")
	}
	if strings.Contains(err.Error(), "super-secret") || strings.Contains(err.Error(), "Authorization") {
		t.Fatalf("error leaked secret/header: %v", err)
	}
}

func TestOpenRouterRejectsLargeAndInvalidResponses(t *testing.T) {
	tests := map[string]string{
		"empty choices": `{"choices":[]}`,
		"bad json":      `{`,
		"invalid tx":    `{"choices":[{"message":{"content":"not json"}}]}`,
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(body)) }))
			defer server.Close()
			client, err := NewOpenRouter(Config{APIKey: "key", Model: "model", BaseURL: server.URL})
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.ParseTransaction(context.Background(), "msg")
			if err == nil {
				t.Fatal("ParseTransaction() error = nil")
			}
		})
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(strings.Repeat("x", 20))) }))
	defer server.Close()
	client, err := NewOpenRouter(Config{APIKey: "key", Model: "model", BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	client.SetMaxResponseBytes(5)
	_, err = client.ParseTransaction(context.Background(), "msg")
	if err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("ParseTransaction() error = %v", err)
	}
}

type errorHTTPClient struct{}

func (errorHTTPClient) Do(*http.Request) (*http.Response, error) {
	return nil, errors.New("network down")
}

func TestOpenRouterContextAndTransportErrors(t *testing.T) {
	client, err := NewOpenRouterWithHTTPClient(Config{APIKey: "secret", Model: "model", BaseURL: "https://example.invalid"}, errorHTTPClient{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.ParseTransaction(context.Background(), "msg")
	if err == nil || !strings.Contains(err.Error(), "network down") || strings.Contains(err.Error(), "secret") {
		t.Fatalf("ParseTransaction() error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = client.ParseTransaction(ctx, "msg")
	if err == nil {
		t.Fatal("ParseTransaction(cancelled) error = nil")
	}
}

func TestNewOpenRouterDisabledOrIncomplete(t *testing.T) {
	if _, err := NewOpenRouter(Config{}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("NewOpenRouter(empty) error = %v", err)
	}
	if _, err := NewOpenRouter(Config{APIKey: "key", Model: "m"}); err == nil || !strings.Contains(err.Error(), "base URL") {
		t.Fatalf("NewOpenRouter(no base URL) error = %v", err)
	}
	if _, err := NewOpenRouter(Config{APIKey: "key", BaseURL: "https://x"}); err == nil || !strings.Contains(err.Error(), "model") {
		t.Fatalf("NewOpenRouter(no model) error = %v", err)
	}
}
