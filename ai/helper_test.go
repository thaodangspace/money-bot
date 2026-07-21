package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/thaodangspace/money-bot/config"
	"github.com/thaodangspace/money-bot/domain"
)

type fakeAI struct {
	parseCalls   int
	confirmCalls int
	summaryCalls int
}

func (f *fakeAI) ParseTransaction(context.Context, string) (domain.Transaction, error) {
	f.parseCalls++
	return domain.Transaction{Type: domain.TransactionExpense, Category: "Ăn", Amount: 1}, nil
}

func (f *fakeAI) Confirmation(context.Context, domain.Transaction, bool) (string, error) {
	f.confirmCalls++
	return "Đã lưu nhé!", nil
}

func (f *fakeAI) SummaryCommentary(context.Context, domain.MonthlySummary) (string, error) {
	f.summaryCalls++
	return "Ổn đó!", nil
}

func TestOptionalReturnsUnavailableWhenUnset(t *testing.T) {
	var optional Optional
	if _, err := optional.ParseTransaction(context.Background(), "msg"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("ParseTransaction() error = %v", err)
	}
	if _, err := optional.Confirmation(context.Background(), domain.Transaction{}, false); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Confirmation() error = %v", err)
	}
}

func TestOptionalDelegates(t *testing.T) {
	fake := &fakeAI{}
	optional := Optional{Parser: fake, Commentary: fake}
	if _, err := optional.ParseTransaction(context.Background(), "msg"); err != nil {
		t.Fatal(err)
	}
	if _, err := optional.Confirmation(context.Background(), domain.Transaction{Type: domain.TransactionExpense, Category: "Ăn", Amount: 1}, true); err != nil {
		t.Fatal(err)
	}
	if _, err := optional.SummaryCommentary(context.Background(), domain.NewMonthlySummary(2026, time.July, 1, 2, 3)); err != nil {
		t.Fatal(err)
	}
	if fake.parseCalls != 1 || fake.confirmCalls != 1 || fake.summaryCalls != 1 {
		t.Fatalf("fake calls parse=%d confirm=%d summary=%d", fake.parseCalls, fake.confirmCalls, fake.summaryCalls)
	}
}

func TestNewFromConfigRequiresEndpointAndModel(t *testing.T) {
	if _, err := NewFromConfig(config.AIConfig{}); err == nil {
		t.Fatal("NewFromConfig(empty) error = nil")
	}
}

func TestNewFromConfigSupportsLMStudioWithoutAPIKey(t *testing.T) {
	client, err := NewFromConfig(config.AIConfig{Provider: config.AIProviderLMStudio, Model: "local-model", BaseURL: "http://localhost:1234/v1", RequestTimeout: time.Second})
	if err != nil {
		t.Fatalf("NewFromConfig(lmstudio) error = %v", err)
	}
	if client == nil {
		t.Fatal("client = nil")
	}
}

func TestNewOpenRouterFromConfigEnabled(t *testing.T) {
	client, err := NewOpenRouterFromConfig(config.AIConfig{Provider: config.AIProviderOpenRouter, APIKey: "key", Model: "model", BaseURL: "https://example.com", RequestTimeout: time.Second})
	if err != nil {
		t.Fatalf("NewOpenRouterFromConfig() error = %v", err)
	}
	if client == nil {
		t.Fatal("client = nil")
	}
}
