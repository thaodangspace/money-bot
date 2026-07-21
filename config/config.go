package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	DefaultMetadataSheet     = "_money_bot_meta"
	DefaultTimezone          = "Asia/Ho_Chi_Minh"
	DefaultUpdateTimeout     = 30 * time.Second
	DefaultShutdownTimeout   = 10 * time.Second
	DefaultGoogleTimeout     = 30 * time.Second
	DefaultAITimeout         = 20 * time.Second
	DefaultMaxInputRunes     = 2000
	DefaultMaxOutputRunes    = 3900
	DefaultAIProvider        = "lmstudio"
	AIProviderLMStudio       = "lmstudio"
	AIProviderOpenRouter     = "openrouter"
	AIProviderOpenAICompat   = "openai_compatible"
	DefaultLMStudioBaseURL   = "http://localhost:1234/v1"
	DefaultLMStudioModel     = "local-model"
	DefaultOpenRouterBaseURL = "https://openrouter.ai/api/v1"
	DefaultOpenRouterModel   = "z-ai/glm-4.5-air:free"
	DefaultOpenRouterReferer = "https://github.com/thaodangspace/money-bot"
	DefaultOpenRouterAppName = "money-bot"
	DefaultGoogleSheetIDEnv  = "GOOGLE_SHEET_ID"
	DefaultTelegramTokenEnv  = "TELEGRAM_BOT_TOKEN"
	DefaultOpenRouterKeyEnv  = "OPENROUTER_API_KEY"
	DefaultLegacyGoogleEmail = "GOOGLE_SERVICE_ACCOUNT_EMAIL"
	DefaultLegacyGooglePKEnv = "GOOGLE_PRIVATE_KEY"
)

type Config struct {
	Telegram TelegramConfig `yaml:"telegram"`
	Google   GoogleConfig   `yaml:"google"`
	App      AppConfig      `yaml:"app"`
	AI       AIConfig       `yaml:"ai"`
}

type TelegramConfig struct {
	Token         string `yaml:"token"`
	TokenEnv      string `yaml:"tokenEnv"`
	AllowedUserID int64  `yaml:"allowedUserId"`
}

type GoogleConfig struct {
	SpreadsheetID          string        `yaml:"spreadsheetId"`
	SpreadsheetIDEnv       string        `yaml:"spreadsheetIdEnv"`
	CredentialsFile        string        `yaml:"credentialsFile"`
	CredentialsJSONEnv     string        `yaml:"credentialsJSONEnv"`
	ServiceAccountEmailEnv string        `yaml:"serviceAccountEmailEnv"`
	PrivateKeyEnv          string        `yaml:"privateKeyEnv"`
	MetadataSheet          string        `yaml:"metadataSheet"`
	RequestTimeout         time.Duration `yaml:"requestTimeout"`

	CredentialSource GoogleCredentialSource `yaml:"-"`
}

type GoogleCredentialKind string

const (
	GoogleCredentialFile      GoogleCredentialKind = "file"
	GoogleCredentialJSONEnv   GoogleCredentialKind = "json_env"
	GoogleCredentialLegacyEnv GoogleCredentialKind = "legacy_env"
)

type GoogleCredentialSource struct {
	Kind       GoogleCredentialKind
	File       string
	JSON       string
	Email      string
	PrivateKey string
}

type AppConfig struct {
	Timezone        string        `yaml:"timezone"`
	UpdateTimeout   time.Duration `yaml:"updateTimeout"`
	ShutdownTimeout time.Duration `yaml:"shutdownTimeout"`
	MaxInputRunes   int           `yaml:"maxInputRunes"`
	MaxOutputRunes  int           `yaml:"maxOutputRunes"`

	Location *time.Location `yaml:"-"`
}

type AIConfig struct {
	// Enabled is kept for backward-compatible config files. AI is always enabled.
	Enabled   bool   `yaml:"enabled"`
	Provider  string `yaml:"provider"`
	APIKeyEnv string `yaml:"apiKeyEnv"`
	APIKey    string `yaml:"-"`
	Model     string `yaml:"model"`
	BaseURL   string `yaml:"baseURL"`

	// OpenRouter fields are kept for backward-compatible config files.
	OpenRouterAPIKeyEnv string        `yaml:"openrouterApiKeyEnv"`
	OpenRouterAPIKey    string        `yaml:"-"`
	OpenRouterModel     string        `yaml:"openrouterModel"`
	OpenRouterBaseURL   string        `yaml:"openrouterBaseURL"`
	OpenRouterReferer   string        `yaml:"openrouterReferer"`
	OpenRouterAppName   string        `yaml:"openrouterAppName"`
	RequestTimeout      time.Duration `yaml:"requestTimeout"`
}

func Load(path string) (*Config, error) {
	return LoadWithEnv(path, os.Getenv)
}

func LoadWithEnv(path string, getenv func(string) string) (*Config, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("config path is required")
	}
	if getenv == nil {
		getenv = os.Getenv
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open config: %w", err)
	}
	defer file.Close()

	var cfg Config
	dec := yaml.NewDecoder(file)
	dec.KnownFields(true)
	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("decode config: %w", err)
	}
	configDir := filepath.Dir(path)
	if err := cfg.normalize(configDir, getenv); err != nil {
		return nil, err
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func (c *Config) normalize(configDir string, getenv func(string) string) error {
	if c.Telegram.TokenEnv == "" && c.Telegram.Token == "" {
		c.Telegram.TokenEnv = DefaultTelegramTokenEnv
	}
	if c.Telegram.Token == "" && c.Telegram.TokenEnv != "" {
		c.Telegram.Token = strings.TrimSpace(getenv(c.Telegram.TokenEnv))
	}

	if c.Google.SpreadsheetIDEnv == "" && c.Google.SpreadsheetID == "" {
		c.Google.SpreadsheetIDEnv = DefaultGoogleSheetIDEnv
	}
	if c.Google.SpreadsheetID == "" && c.Google.SpreadsheetIDEnv != "" {
		c.Google.SpreadsheetID = strings.TrimSpace(getenv(c.Google.SpreadsheetIDEnv))
	}
	if c.Google.SpreadsheetID == "" {
		c.Google.SpreadsheetID = strings.TrimSpace(getenv(DefaultGoogleSheetIDEnv))
	}
	if c.Google.MetadataSheet == "" {
		c.Google.MetadataSheet = DefaultMetadataSheet
	}
	if c.Google.RequestTimeout == 0 {
		c.Google.RequestTimeout = DefaultGoogleTimeout
	}
	if c.Google.CredentialsFile != "" {
		expanded, err := expandPath(c.Google.CredentialsFile, configDir)
		if err != nil {
			return fmt.Errorf("google.credentialsFile: %w", err)
		}
		c.Google.CredentialsFile = expanded
	}
	if c.Google.ServiceAccountEmailEnv == "" && c.Google.PrivateKeyEnv == "" && c.Google.CredentialsFile == "" && c.Google.CredentialsJSONEnv == "" {
		c.Google.ServiceAccountEmailEnv = DefaultLegacyGoogleEmail
		c.Google.PrivateKeyEnv = DefaultLegacyGooglePKEnv
	}
	if err := c.resolveGoogleCredentialSource(getenv); err != nil {
		return err
	}

	if c.App.Timezone == "" {
		c.App.Timezone = DefaultTimezone
	}
	loc, err := time.LoadLocation(c.App.Timezone)
	if err != nil {
		return fmt.Errorf("app.timezone: %w", err)
	}
	c.App.Location = loc
	if c.App.UpdateTimeout == 0 {
		c.App.UpdateTimeout = DefaultUpdateTimeout
	}
	if c.App.ShutdownTimeout == 0 {
		c.App.ShutdownTimeout = DefaultShutdownTimeout
	}
	if c.App.MaxInputRunes == 0 {
		c.App.MaxInputRunes = DefaultMaxInputRunes
	}
	if c.App.MaxOutputRunes == 0 {
		c.App.MaxOutputRunes = DefaultMaxOutputRunes
	}

	c.normalizeAI(getenv)
	return nil
}

func (c *Config) normalizeAI(getenv func(string) string) {
	// AI is mandatory. The enabled flag is accepted for old config files but no longer disables AI.
	c.AI.Enabled = true

	if c.AI.OpenRouterAPIKeyEnv == "" {
		c.AI.OpenRouterAPIKeyEnv = DefaultOpenRouterKeyEnv
	}
	if c.AI.OpenRouterAPIKeyEnv != "" {
		c.AI.OpenRouterAPIKey = strings.TrimSpace(getenv(c.AI.OpenRouterAPIKeyEnv))
	}
	if c.AI.APIKeyEnv != "" {
		c.AI.APIKey = strings.TrimSpace(getenv(c.AI.APIKeyEnv))
	}

	if c.AI.Provider == "" {
		if c.AI.OpenRouterAPIKey != "" || c.AI.OpenRouterAPIKeyEnv != DefaultOpenRouterKeyEnv {
			c.AI.Provider = AIProviderOpenRouter
		} else {
			c.AI.Provider = DefaultAIProvider
		}
	}
	c.AI.Provider = strings.ToLower(strings.TrimSpace(c.AI.Provider))

	switch c.AI.Provider {
	case AIProviderOpenRouter:
		if c.AI.Model == "" {
			c.AI.Model = firstNonEmpty(c.AI.OpenRouterModel, DefaultOpenRouterModel)
		}
		if c.AI.BaseURL == "" {
			c.AI.BaseURL = firstNonEmpty(c.AI.OpenRouterBaseURL, DefaultOpenRouterBaseURL)
		}
		if c.AI.APIKey == "" {
			c.AI.APIKey = c.AI.OpenRouterAPIKey
		}
	case AIProviderLMStudio:
		if c.AI.Model == "" {
			c.AI.Model = DefaultLMStudioModel
		}
		if c.AI.BaseURL == "" {
			c.AI.BaseURL = DefaultLMStudioBaseURL
		}
	case AIProviderOpenAICompat:
		if c.AI.Model == "" {
			c.AI.Model = c.AI.OpenRouterModel
		}
		if c.AI.BaseURL == "" {
			c.AI.BaseURL = c.AI.OpenRouterBaseURL
		}
		if c.AI.APIKey == "" {
			c.AI.APIKey = c.AI.OpenRouterAPIKey
		}
	}

	if c.AI.OpenRouterModel == "" {
		c.AI.OpenRouterModel = DefaultOpenRouterModel
	}
	if c.AI.OpenRouterBaseURL == "" {
		c.AI.OpenRouterBaseURL = DefaultOpenRouterBaseURL
	}
	if c.AI.OpenRouterReferer == "" {
		c.AI.OpenRouterReferer = DefaultOpenRouterReferer
	}
	if c.AI.OpenRouterAppName == "" {
		c.AI.OpenRouterAppName = DefaultOpenRouterAppName
	}
	if c.AI.RequestTimeout == 0 {
		c.AI.RequestTimeout = DefaultAITimeout
	}
}

func (c *Config) resolveGoogleCredentialSource(getenv func(string) string) error {
	type candidate struct {
		kind GoogleCredentialKind
		ok   bool
		src  GoogleCredentialSource
	}
	candidates := []candidate{}
	if c.Google.CredentialsFile != "" {
		candidates = append(candidates, candidate{kind: GoogleCredentialFile, ok: true, src: GoogleCredentialSource{Kind: GoogleCredentialFile, File: c.Google.CredentialsFile}})
	}
	if c.Google.CredentialsJSONEnv != "" {
		value := strings.TrimSpace(getenv(c.Google.CredentialsJSONEnv))
		if value == "" {
			return fmt.Errorf("google.credentialsJSONEnv %q is set but environment variable is empty", c.Google.CredentialsJSONEnv)
		}
		candidates = append(candidates, candidate{kind: GoogleCredentialJSONEnv, ok: true, src: GoogleCredentialSource{Kind: GoogleCredentialJSONEnv, JSON: value}})
	}
	legacyConfigured := c.Google.ServiceAccountEmailEnv != "" || c.Google.PrivateKeyEnv != ""
	if legacyConfigured {
		if c.Google.ServiceAccountEmailEnv == "" || c.Google.PrivateKeyEnv == "" {
			return errors.New("google service account legacy credentials require both serviceAccountEmailEnv and privateKeyEnv")
		}
		email := strings.TrimSpace(getenv(c.Google.ServiceAccountEmailEnv))
		privateKey := strings.TrimSpace(getenv(c.Google.PrivateKeyEnv))
		if email == "" || privateKey == "" {
			return fmt.Errorf("google legacy credential environment variables %q and %q must both be set", c.Google.ServiceAccountEmailEnv, c.Google.PrivateKeyEnv)
		}
		privateKey = strings.ReplaceAll(privateKey, `\n`, "\n")
		candidates = append(candidates, candidate{kind: GoogleCredentialLegacyEnv, ok: true, src: GoogleCredentialSource{Kind: GoogleCredentialLegacyEnv, Email: email, PrivateKey: privateKey}})
	}
	if len(candidates) != 1 {
		return fmt.Errorf("google credentials require exactly one source; got %d", len(candidates))
	}
	c.Google.CredentialSource = candidates[0].src
	return nil
}

func (c Config) Validate() error {
	var errs []error
	if strings.TrimSpace(c.Telegram.Token) == "" {
		errs = append(errs, errors.New("telegram token is required via telegram.token or telegram.tokenEnv"))
	}
	if c.Telegram.AllowedUserID <= 0 {
		errs = append(errs, errors.New("telegram.allowedUserId must be positive"))
	}
	if strings.TrimSpace(c.Google.SpreadsheetID) == "" {
		errs = append(errs, errors.New("google.spreadsheetId is required via google.spreadsheetId, google.spreadsheetIdEnv, or GOOGLE_SHEET_ID"))
	}
	if strings.TrimSpace(c.Google.MetadataSheet) == "" {
		errs = append(errs, errors.New("google.metadataSheet is required"))
	}
	if c.Google.RequestTimeout <= 0 {
		errs = append(errs, errors.New("google.requestTimeout must be positive"))
	}
	if c.Google.CredentialSource.Kind == "" {
		errs = append(errs, errors.New("google credentials are required"))
	}
	if c.App.Location == nil {
		errs = append(errs, errors.New("app.timezone must resolve to a location"))
	}
	if c.App.UpdateTimeout <= 0 {
		errs = append(errs, errors.New("app.updateTimeout must be positive"))
	}
	if c.App.ShutdownTimeout <= 0 {
		errs = append(errs, errors.New("app.shutdownTimeout must be positive"))
	}
	if c.App.MaxInputRunes < 1 {
		errs = append(errs, errors.New("app.maxInputRunes must be positive"))
	}
	if c.App.MaxOutputRunes < 1 {
		errs = append(errs, errors.New("app.maxOutputRunes must be positive"))
	}
	if c.AI.RequestTimeout <= 0 {
		errs = append(errs, errors.New("ai.requestTimeout must be positive"))
	}
	if strings.TrimSpace(c.AI.Provider) == "" {
		errs = append(errs, errors.New("ai.provider is required"))
	}
	switch c.AI.Provider {
	case AIProviderLMStudio, AIProviderOpenRouter, AIProviderOpenAICompat:
	default:
		errs = append(errs, fmt.Errorf("ai.provider must be one of %q, %q, or %q", AIProviderLMStudio, AIProviderOpenRouter, AIProviderOpenAICompat))
	}
	if strings.TrimSpace(c.AI.Model) == "" {
		errs = append(errs, errors.New("ai.model is required"))
	}
	if strings.TrimSpace(c.AI.BaseURL) == "" {
		errs = append(errs, errors.New("ai.baseURL is required"))
	}
	if c.AI.Provider == AIProviderOpenRouter && strings.TrimSpace(c.AI.APIKey) == "" {
		errs = append(errs, errors.New("ai.provider=openrouter requires an API key via ai.apiKeyEnv or ai.openrouterApiKeyEnv"))
	}
	return errors.Join(errs...)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func expandPath(path, baseDir string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", nil
	}
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
		if path == "~" {
			path = home
		} else {
			path = filepath.Join(home, path[2:])
		}
	}
	path = os.ExpandEnv(path)
	if !filepath.IsAbs(path) {
		path = filepath.Join(baseDir, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return filepath.Clean(abs), nil
}
