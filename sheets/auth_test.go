package sheets

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dtonair/money-bot/config"
)

func TestCredentialJSONFromFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "creds.json")
	if err := os.WriteFile(file, []byte(`{"type":"service_account"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	data, err := CredentialJSON(config.GoogleCredentialSource{Kind: config.GoogleCredentialFile, File: file})
	if err != nil {
		t.Fatalf("CredentialJSON() error = %v", err)
	}
	if string(data) != `{"type":"service_account"}` {
		t.Fatalf("data = %s", data)
	}
}

func TestCredentialJSONFromEnvJSON(t *testing.T) {
	data, err := CredentialJSON(config.GoogleCredentialSource{Kind: config.GoogleCredentialJSONEnv, JSON: `{"client_email":"x"}`})
	if err != nil {
		t.Fatalf("CredentialJSON() error = %v", err)
	}
	if string(data) != `{"client_email":"x"}` {
		t.Fatalf("data = %s", data)
	}
}

func TestCredentialJSONFromLegacyEnvShapeDoesNotExposePrivateKeyInError(t *testing.T) {
	data, err := CredentialJSON(config.GoogleCredentialSource{Kind: config.GoogleCredentialLegacyEnv, Email: "bot@example.com", PrivateKey: "secret-private-key"})
	if err != nil {
		t.Fatalf("CredentialJSON() error = %v", err)
	}
	text := string(data)
	for _, want := range []string{`"type":"service_account"`, `"client_email":"bot@example.com"`, `"private_key":"secret-private-key"`} {
		if !strings.Contains(text, want) {
			t.Fatalf("credential JSON %s missing %s", text, want)
		}
	}
	_, err = CredentialJSON(config.GoogleCredentialSource{Kind: config.GoogleCredentialLegacyEnv, Email: "bot@example.com"})
	if err == nil {
		t.Fatal("CredentialJSON() error = nil")
	}
	if strings.Contains(err.Error(), "secret-private-key") {
		t.Fatalf("error leaked secret: %v", err)
	}
}

func TestClientOptionsUsesSpreadsheetScope(t *testing.T) {
	opts, err := ClientOptions(config.GoogleCredentialSource{Kind: config.GoogleCredentialJSONEnv, JSON: `{"type":"service_account"}`})
	if err != nil {
		t.Fatalf("ClientOptions() error = %v", err)
	}
	if len(opts) != 2 {
		t.Fatalf("len(opts) = %d", len(opts))
	}
	if SpreadsheetScope != "https://www.googleapis.com/auth/spreadsheets" {
		t.Fatalf("SpreadsheetScope = %q", SpreadsheetScope)
	}
}
