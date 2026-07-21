package ai

import "github.com/thaodangspace/money-bot/config"

func NewFromConfig(cfg config.AIConfig) (*Client, error) {
	provider := cfg.Provider
	if provider == "" && cfg.OpenRouterAPIKey != "" {
		provider = config.AIProviderOpenRouter
	}
	apiKey := cfg.APIKey
	if apiKey == "" {
		apiKey = cfg.OpenRouterAPIKey
	}
	model := cfg.Model
	if model == "" {
		model = cfg.OpenRouterModel
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = cfg.OpenRouterBaseURL
	}
	clientCfg := Config{
		Provider:       provider,
		APIKey:         apiKey,
		Model:          model,
		BaseURL:        baseURL,
		Referer:        cfg.OpenRouterReferer,
		AppName:        cfg.OpenRouterAppName,
		RequestTimeout: cfg.RequestTimeout,
	}
	if provider == config.AIProviderOpenRouter {
		return NewOpenRouter(clientCfg)
	}
	return NewClient(clientCfg)
}

func NewOpenRouterFromConfig(cfg config.AIConfig) (*Client, error) {
	return NewFromConfig(cfg)
}
