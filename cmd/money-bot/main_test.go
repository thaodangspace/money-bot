package main

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/thaodangspace/money-bot/config"
	"github.com/thaodangspace/money-bot/sheets"
	"github.com/thaodangspace/money-bot/telegram"
	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

func TestRunDryRunValidatesConfigWithoutLoggingSecrets(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeMainConfig(t, cfgPath, `
telegram:
  tokenEnv: BOT_TOKEN
  allowedUserId: 42
google:
  spreadsheetIdEnv: SHEET_ID
app: {}
ai:
  enabled: true
  openrouterApiKeyEnv: OR_KEY
`)
	env := map[string]string{
		"BOT_TOKEN":                    "telegram-secret",
		"SHEET_ID":                     "sheet-secret-ish",
		"GOOGLE_SERVICE_ACCOUNT_EMAIL": "bot@example.iam.gserviceaccount.com",
		"GOOGLE_PRIVATE_KEY":           "private-key-secret",
		"OR_KEY":                       "openrouter-secret",
	}
	var out bytes.Buffer
	err := run([]string{"--config", cfgPath, "--dry-run"}, &out, mapMainEnv(env))
	if err != nil {
		t.Fatalf("run() error = %v\noutput:\n%s", err, out.String())
	}
	text := out.String()
	if !strings.Contains(text, "configuration validated") || !strings.Contains(text, "google_credential_kind=legacy_env") || !strings.Contains(text, "ai_enabled=true") {
		t.Fatalf("dry-run output = %q", text)
	}
	for _, secret := range []string{"telegram-secret", "private-key-secret", "openrouter-secret", "sheet-secret-ish"} {
		if strings.Contains(text, secret) {
			t.Fatalf("dry-run output leaked secret %q: %q", secret, text)
		}
	}
}

func TestRunInvalidConfigReturnsActionableError(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeMainConfig(t, cfgPath, `
telegram:
  token: tok
  allowedUserId: 0
google:
  spreadsheetId: sheet
  credentialsFile: ./creds.json
app: {}
ai: {}
`)
	var out bytes.Buffer
	err := run([]string{"--config", cfgPath, "--dry-run"}, &out, mapMainEnv(nil))
	if err == nil || !strings.Contains(err.Error(), "allowedUserId") {
		t.Fatalf("run() error = %v, want allowedUserId", err)
	}
}

func TestRunLiveModeComposesDependenciesWithHooks(t *testing.T) {
	oldSheets, oldTelegram, oldPoll := makeSheetsAPI, makeTelegram, pollTelegram
	defer func() { makeSheetsAPI, makeTelegram, pollTelegram = oldSheets, oldTelegram, oldPoll }()

	var sheetsCalled, telegramCalled, pollCalled bool
	makeSheetsAPI = func(_ context.Context, cfg *config.Config) (sheets.API, error) {
		sheetsCalled = true
		if cfg.Google.SpreadsheetID != "sheet" {
			t.Fatalf("spreadsheet ID = %q", cfg.Google.SpreadsheetID)
		}
		return fakeSheetsAPI{}, nil
	}
	makeTelegram = func(token string) (telegram.BotAPI, error) {
		telegramCalled = true
		if token != "tok" {
			t.Fatalf("telegram token = %q", token)
		}
		return fakeBot{}, nil
	}
	pollTelegram = func(_ context.Context, _ telegram.BotAPI, handler *telegram.Handler, _ *slog.Logger, timeout time.Duration) error {
		pollCalled = true
		if handler == nil {
			t.Fatal("handler = nil")
		}
		if timeout != config.DefaultUpdateTimeout {
			t.Fatalf("timeout = %v", timeout)
		}
		return nil
	}

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeMainConfig(t, cfgPath, `
telegram:
  token: tok
  allowedUserId: 42
google:
  spreadsheetId: sheet
  credentialsFile: ./creds.json
app: {}
ai: {}
`)
	var out bytes.Buffer
	if err := run([]string{"--config", cfgPath}, &out, mapMainEnv(nil)); err != nil {
		t.Fatalf("run() error = %v", err)
	}
	if !sheetsCalled || !telegramCalled || !pollCalled {
		t.Fatalf("calls sheets=%v telegram=%v poll=%v", sheetsCalled, telegramCalled, pollCalled)
	}
}

func TestDryRunDoesNotConstructNetworkClients(t *testing.T) {
	oldSheets, oldTelegram, oldPoll := makeSheetsAPI, makeTelegram, pollTelegram
	defer func() { makeSheetsAPI, makeTelegram, pollTelegram = oldSheets, oldTelegram, oldPoll }()
	makeSheetsAPI = func(context.Context, *config.Config) (sheets.API, error) {
		t.Fatal("makeSheetsAPI called in dry-run")
		return nil, nil
	}
	makeTelegram = func(string) (telegram.BotAPI, error) { t.Fatal("makeTelegram called in dry-run"); return nil, nil }
	pollTelegram = func(context.Context, telegram.BotAPI, *telegram.Handler, *slog.Logger, time.Duration) error {
		t.Fatal("pollTelegram called in dry-run")
		return nil
	}

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeMainConfig(t, cfgPath, `
telegram:
  token: tok
  allowedUserId: 42
google:
  spreadsheetId: sheet
  credentialsFile: ./creds.json
app: {}
ai: {}
`)
	if err := run([]string{"--config", cfgPath, "--dry-run"}, &bytes.Buffer{}, mapMainEnv(nil)); err != nil {
		t.Fatalf("run() error = %v", err)
	}
}

func TestParseLogLevel(t *testing.T) {
	tests := map[string]slog.Level{
		"debug": slog.LevelDebug,
		"info":  slog.LevelInfo,
		"warn":  slog.LevelWarn,
		"error": slog.LevelError,
		"bad":   slog.LevelInfo,
	}
	for input, want := range tests {
		got := parseLogLevel(input).Level()
		if got != want {
			t.Fatalf("parseLogLevel(%q) = %v, want %v", input, got, want)
		}
	}
}

type fakeSheetsAPI struct{}

func (fakeSheetsAPI) GetSpreadsheet(context.Context, string) (sheets.Spreadsheet, error) {
	return sheets.Spreadsheet{}, nil
}

func (fakeSheetsAPI) GetValues(context.Context, string, string) ([][]string, error) {
	return nil, sheets.ErrSheetNotFound
}

func (fakeSheetsAPI) BatchUpdate(context.Context, string, sheets.BatchUpdateRequest) error {
	return nil
}

type fakeBot struct{}

func (fakeBot) Send(tgbotapi.Chattable) (tgbotapi.Message, error) { return tgbotapi.Message{}, nil }
func (fakeBot) Request(tgbotapi.Chattable) (*tgbotapi.APIResponse, error) {
	return &tgbotapi.APIResponse{Ok: true}, nil
}
func (fakeBot) GetUpdatesChan(tgbotapi.UpdateConfig) tgbotapi.UpdatesChannel { return nil }
func (fakeBot) StopReceivingUpdates()                                        {}

func writeMainConfig(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func mapMainEnv(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}
