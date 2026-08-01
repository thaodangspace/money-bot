package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestParseImageTransactionUsesImageModelAndTextFirstDataURL(t *testing.T) {
	for _, provider := range []struct {
		name   string
		client func(Config) (*Client, error)
		apiKey string
	}{
		{"lmstudio", NewClient, ""},
		{"openrouter", NewOpenRouter, "secret"},
	} {
		t.Run(provider.name, func(t *testing.T) {
			var request struct {
				Model    string `json:"model"`
				Messages []struct {
					Role    string          `json:"role"`
					Content json.RawMessage `json:"content"`
				} `json:"messages"`
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Fatal(err)
				}
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"type\":\"expense\",\"category\":\"food\",\"amount\":150000,\"note\":\"merchant\"}"}}]}`))
			}))
			defer server.Close()
			client, err := provider.client(Config{Provider: provider.name, APIKey: provider.apiKey, Model: "text-model", ImageModel: "vision-model", BaseURL: server.URL, RequestTimeout: time.Second})
			if err != nil {
				t.Fatal(err)
			}
			image := []byte{0xff, 0xd8, 0xff}
			tx, err := client.ParseImageTransaction(context.Background(), "receipt caption", "image/jpeg", image)
			if err != nil {
				t.Fatal(err)
			}
			if tx.Amount != 150000 || request.Model != "vision-model" || len(request.Messages) != 2 || request.Messages[0].Role != "system" {
				t.Fatalf("tx=%#v request=%#v", tx, request)
			}
			var parts []struct {
				Type     string `json:"type"`
				Text     string `json:"text"`
				ImageURL struct {
					URL string `json:"url"`
				} `json:"image_url"`
			}
			if err := json.Unmarshal(request.Messages[1].Content, &parts); err != nil {
				t.Fatal(err)
			}
			if len(parts) != 2 || parts[0].Type != "text" || !strings.Contains(parts[0].Text, "receipt caption") || parts[1].Type != "image_url" {
				t.Fatalf("parts=%#v", parts)
			}
			wantURL := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(image)
			if parts[1].ImageURL.URL != wantURL {
				t.Fatalf("data URL = %q", parts[1].ImageURL.URL)
			}
		})
	}
}

func TestParseImageTransactionRejectsUnsupportedInputAndSafeErrors(t *testing.T) {
	client, err := NewClient(Config{Model: "text", ImageModel: "vision", BaseURL: "http://example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.ParseImageTransaction(context.Background(), "caption", "image/gif", []byte("GIF89a")); err == nil {
		t.Fatal("unsupported image was accepted")
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "ignored", http.StatusBadRequest) }))
	defer server.Close()
	client, err = NewClient(Config{Model: "text", ImageModel: "vision", BaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.ParseImageTransaction(context.Background(), "sensitive caption", "image/png", []byte{0x89, 'P', 'N', 'G'})
	if err == nil || strings.Contains(err.Error(), "sensitive caption") || strings.Contains(err.Error(), "iVBOR") {
		t.Fatalf("error exposed image input: %v", err)
	}
}
