package sheets

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/dtonair/money-bot/config"
	"google.golang.org/api/option"
)

const SpreadsheetScope = "https://www.googleapis.com/auth/spreadsheets"

type legacyServiceAccountJSON struct {
	Type        string `json:"type"`
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
}

func CredentialJSON(source config.GoogleCredentialSource) ([]byte, error) {
	switch source.Kind {
	case config.GoogleCredentialFile:
		data, err := os.ReadFile(source.File)
		if err != nil {
			return nil, fmt.Errorf("read google credentials file: %w", err)
		}
		return data, nil
	case config.GoogleCredentialJSONEnv:
		if source.JSON == "" {
			return nil, fmt.Errorf("google credentials JSON is empty")
		}
		return []byte(source.JSON), nil
	case config.GoogleCredentialLegacyEnv:
		if source.Email == "" || source.PrivateKey == "" {
			return nil, fmt.Errorf("google legacy credentials require email and private key")
		}
		data, err := json.Marshal(legacyServiceAccountJSON{Type: "service_account", ClientEmail: source.Email, PrivateKey: source.PrivateKey})
		if err != nil {
			return nil, fmt.Errorf("marshal google legacy credentials: %w", err)
		}
		return data, nil
	default:
		return nil, fmt.Errorf("unsupported google credential source %q", source.Kind)
	}
}

func ClientOptions(source config.GoogleCredentialSource) ([]option.ClientOption, error) {
	data, err := CredentialJSON(source)
	if err != nil {
		return nil, err
	}
	return []option.ClientOption{option.WithCredentialsJSON(data), option.WithScopes(SpreadsheetScope)}, nil
}
