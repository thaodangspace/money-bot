package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadAppliesDefaultsAndExpandsCredentialPath(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeConfig(t, cfgPath, `
telegram:
  token: test-token
  allowedUserId: 42
google:
  spreadsheetId: sheet-1
  credentialsFile: ./creds.json
app: {}
ai: {}
`)

	cfg, err := LoadWithEnv(cfgPath, mapEnv(nil))
	if err != nil {
		t.Fatalf("LoadWithEnv() error = %v", err)
	}
	if cfg.Telegram.Token != "test-token" || cfg.Telegram.AllowedUserID != 42 {
		t.Fatalf("telegram = %#v", cfg.Telegram)
	}
	wantCreds := filepath.Join(dir, "creds.json")
	if cfg.Google.CredentialSource.Kind != GoogleCredentialFile || cfg.Google.CredentialSource.File != wantCreds {
		t.Fatalf("credential source = %#v, want file %q", cfg.Google.CredentialSource, wantCreds)
	}
	if cfg.Google.MetadataSheet != DefaultMetadataSheet || cfg.Google.RequestTimeout != DefaultGoogleTimeout {
		t.Fatalf("google defaults = %#v", cfg.Google)
	}
	if cfg.App.Timezone != DefaultTimezone || cfg.App.Location == nil || cfg.App.UpdateTimeout != DefaultUpdateTimeout || cfg.App.ShutdownTimeout != DefaultShutdownTimeout {
		t.Fatalf("app defaults = %#v", cfg.App)
	}
	if cfg.App.MaxInputRunes != DefaultMaxInputRunes || cfg.App.MaxOutputRunes != DefaultMaxOutputRunes {
		t.Fatalf("app size defaults = %#v", cfg.App)
	}
	if !cfg.AI.Enabled || cfg.AI.Provider != AIProviderLMStudio || cfg.AI.BaseURL != DefaultLMStudioBaseURL || cfg.AI.Model != DefaultLMStudioModel {
		t.Fatalf("ai defaults = %#v", cfg.AI)
	}
}

func TestLoadReadsTokenSpreadsheetAndLegacyGoogleCredentialsFromEnvironment(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeConfig(t, cfgPath, `
telegram:
  tokenEnv: BOT_TOKEN
  allowedUserId: 42
google: {}
app: {}
ai: {}
`)
	env := map[string]string{
		"BOT_TOKEN":              "telegram-token",
		DefaultGoogleSheetIDEnv:  "sheet-from-env",
		DefaultLegacyGoogleEmail: "bot@example.iam.gserviceaccount.com",
		DefaultLegacyGooglePKEnv: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
	}

	cfg, err := LoadWithEnv(cfgPath, mapEnv(env))
	if err != nil {
		t.Fatalf("LoadWithEnv() error = %v", err)
	}
	if cfg.Telegram.Token != "telegram-token" {
		t.Fatalf("telegram token = %q", cfg.Telegram.Token)
	}
	if cfg.Google.SpreadsheetID != "sheet-from-env" {
		t.Fatalf("spreadsheet ID = %q", cfg.Google.SpreadsheetID)
	}
	if cfg.Google.CredentialSource.Kind != GoogleCredentialLegacyEnv {
		t.Fatalf("credential source = %#v", cfg.Google.CredentialSource)
	}
	if !strings.Contains(cfg.Google.CredentialSource.PrivateKey, "\nabc\n") {
		t.Fatalf("private key newlines were not normalized: %q", cfg.Google.CredentialSource.PrivateKey)
	}
}

func TestLoadReadsCredentialsJSONEnv(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeConfig(t, cfgPath, `
telegram:
  token: tok
  allowedUserId: 42
google:
  spreadsheetId: sheet
  credentialsJSONEnv: GOOGLE_CREDS_JSON
app: {}
ai: {}
`)
	cfg, err := LoadWithEnv(cfgPath, mapEnv(map[string]string{"GOOGLE_CREDS_JSON": `{"type":"service_account"}`}))
	if err != nil {
		t.Fatalf("LoadWithEnv() error = %v", err)
	}
	if cfg.Google.CredentialSource.Kind != GoogleCredentialJSONEnv || cfg.Google.CredentialSource.JSON == "" {
		t.Fatalf("credential source = %#v", cfg.Google.CredentialSource)
	}
}

func TestLoadRejectsConflictingGoogleCredentialSources(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeConfig(t, cfgPath, `
telegram:
  token: tok
  allowedUserId: 42
google:
  spreadsheetId: sheet
  credentialsFile: ./creds.json
  credentialsJSONEnv: GOOGLE_CREDS_JSON
app: {}
ai: {}
`)
	_, err := LoadWithEnv(cfgPath, mapEnv(map[string]string{"GOOGLE_CREDS_JSON": `{}`}))
	if err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("LoadWithEnv() error = %v, want exactly one", err)
	}
}

func TestLoadRejectsMissingCredentialEnvValue(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeConfig(t, cfgPath, `
telegram:
  token: tok
  allowedUserId: 42
google:
  spreadsheetId: sheet
  credentialsJSONEnv: GOOGLE_CREDS_JSON
app: {}
ai: {}
`)
	_, err := LoadWithEnv(cfgPath, mapEnv(nil))
	if err == nil || !strings.Contains(err.Error(), "environment variable is empty") {
		t.Fatalf("LoadWithEnv() error = %v", err)
	}
}

func TestLoadRejectsUnknownFields(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeConfig(t, cfgPath, `
telegram:
  token: tok
  allowedUserId: 42
unknown: true
google:
  spreadsheetId: sheet
  credentialsFile: ./creds.json
app: {}
ai: {}
`)
	_, err := LoadWithEnv(cfgPath, mapEnv(nil))
	if err == nil || !strings.Contains(err.Error(), "field unknown not found") {
		t.Fatalf("LoadWithEnv() error = %v", err)
	}
}

func TestLoadRejectsInvalidTimezoneAndNonPositiveTimeouts(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeConfig(t, cfgPath, `
telegram:
  token: tok
  allowedUserId: 42
google:
  spreadsheetId: sheet
  credentialsFile: ./creds.json
app:
  timezone: Not/AZone
  updateTimeout: 1s
  shutdownTimeout: 1s
  maxInputRunes: 1
  maxOutputRunes: 1
ai: {}
`)
	_, err := LoadWithEnv(cfgPath, mapEnv(nil))
	if err == nil || !strings.Contains(err.Error(), "app.timezone") {
		t.Fatalf("LoadWithEnv() error = %v", err)
	}

	bad := Config{Telegram: TelegramConfig{Token: "tok", AllowedUserID: 42}, Google: GoogleConfig{SpreadsheetID: "sheet", MetadataSheet: "meta", CredentialSource: GoogleCredentialSource{Kind: GoogleCredentialFile, File: "/x"}}, App: AppConfig{Location: time.Local}, AI: AIConfig{RequestTimeout: time.Second}}
	err = bad.Validate()
	if err == nil || !strings.Contains(err.Error(), "updateTimeout") || !strings.Contains(err.Error(), "shutdownTimeout") || !strings.Contains(err.Error(), "maxInputRunes") || !strings.Contains(err.Error(), "maxOutputRunes") {
		t.Fatalf("Validate() error = %v", err)
	}
}

func TestOpenRouterRequiresAndLoadsAPIKey(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	writeConfig(t, cfgPath, `
telegram:
  token: tok
  allowedUserId: 42
google:
  spreadsheetId: sheet
  credentialsFile: ./creds.json
app: {}
ai:
  provider: openrouter
  openrouterApiKeyEnv: OR_KEY
`)
	_, err := LoadWithEnv(cfgPath, mapEnv(nil))
	if err == nil || !strings.Contains(err.Error(), "openrouter requires") {
		t.Fatalf("LoadWithEnv() error = %v, want AI key error", err)
	}
	cfg, err := LoadWithEnv(cfgPath, mapEnv(map[string]string{"OR_KEY": "sk-test"}))
	if err != nil {
		t.Fatalf("LoadWithEnv() with key error = %v", err)
	}
	if cfg.AI.APIKey != "sk-test" || cfg.AI.OpenRouterAPIKey != "sk-test" {
		t.Fatalf("AI keys = generic %q openrouter %q", cfg.AI.APIKey, cfg.AI.OpenRouterAPIKey)
	}
}

func writeConfig(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func mapEnv(values map[string]string) func(string) string {
	return func(key string) string {
		return values[key]
	}
}
