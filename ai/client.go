package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dtonair/money-bot/domain"
)

const defaultMaxResponseBytes int64 = 256 * 1024

type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

type Client struct {
	httpClient       HTTPClient
	provider         string
	baseURL          string
	apiKey           string
	model            string
	referer          string
	appName          string
	maxResponseBytes int64
}

type Config struct {
	Provider       string
	APIKey         string
	Model          string
	BaseURL        string
	Referer        string
	AppName        string
	RequestTimeout time.Duration
}

func NewClient(cfg Config) (*Client, error) {
	provider := strings.TrimSpace(cfg.Provider)
	if provider == "" {
		provider = "openai_compatible"
	}
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil, fmt.Errorf("%s base URL is required", provider)
	}
	if strings.TrimSpace(cfg.Model) == "" {
		return nil, fmt.Errorf("%s model is required", provider)
	}
	timeout := cfg.RequestTimeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	return &Client{
		httpClient:       &http.Client{Timeout: timeout},
		provider:         provider,
		baseURL:          strings.TrimRight(cfg.BaseURL, "/"),
		apiKey:           strings.TrimSpace(cfg.APIKey),
		model:            strings.TrimSpace(cfg.Model),
		referer:          cfg.Referer,
		appName:          cfg.AppName,
		maxResponseBytes: defaultMaxResponseBytes,
	}, nil
}

func NewOpenRouter(cfg Config) (*Client, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, ErrUnavailable
	}
	if cfg.Provider == "" {
		cfg.Provider = "openrouter"
	}
	return NewClient(cfg)
}

func NewOpenRouterWithHTTPClient(cfg Config, httpClient HTTPClient) (*Client, error) {
	client, err := NewOpenRouter(cfg)
	if err != nil {
		return nil, err
	}
	if httpClient != nil {
		client.httpClient = httpClient
	}
	return client, nil
}

func NewClientWithHTTPClient(cfg Config, httpClient HTTPClient) (*Client, error) {
	client, err := NewClient(cfg)
	if err != nil {
		return nil, err
	}
	if httpClient != nil {
		client.httpClient = httpClient
	}
	return client, nil
}

func (c *Client) SetMaxResponseBytes(max int64) {
	if max > 0 {
		c.maxResponseBytes = max
	}
}

func (c *Client) ParseTransaction(ctx context.Context, message string) (domain.Transaction, error) {
	content, err := c.chat(ctx, []chatMessage{
		{Role: "system", Content: transactionSystemPrompt},
		{Role: "user", Content: "Message:\n" + message},
	}, 0.2)
	if err != nil {
		return domain.Transaction{}, err
	}
	return ParseTransactionJSON(content)
}

func (c *Client) Confirmation(ctx context.Context, tx domain.Transaction, usedAI bool) (string, error) {
	content, err := c.chat(ctx, []chatMessage{
		{Role: "system", Content: "Bạn là bot ghi chép chi tiêu vui vẻ. Trả lời tiếng Việt dưới 30 từ, không nêu lại số tiền nếu không cần."},
		{Role: "user", Content: fmt.Sprintf("Đã lưu giao dịch type=%s content=%q amount=%d usedAI=%v. Viết một câu xác nhận ngắn.", tx.Type, tx.Content(), tx.Amount, usedAI)},
	}, 0.6)
	if err != nil {
		return "", err
	}
	return truncateRunes(strings.TrimSpace(content), 240), nil
}

func (c *Client) SummaryCommentary(ctx context.Context, summary domain.MonthlySummary) (string, error) {
	content, err := c.chat(ctx, []chatMessage{
		{Role: "system", Content: "Bạn là bot tài chính vui vẻ. Viết một nhận xét tiếng Việt dưới 40 từ. Không thay đổi hoặc tính lại số liệu."},
		{Role: "user", Content: fmt.Sprintf("Tháng %02d/%04d: chi=%d, thu=%d, cân bằng=%d, số giao dịch=%d. Viết nhận xét ngắn, không thay số.", int(summary.Month), summary.Year, summary.TotalExpenses, summary.TotalIncome, summary.Balance, summary.EntryCount)},
	}, 0.5)
	if err != nil {
		return "", err
	}
	return truncateRunes(strings.TrimSpace(content), 320), nil
}

func (c *Client) chat(ctx context.Context, messages []chatMessage, temperature float64) (string, error) {
	if c == nil {
		return "", ErrUnavailable
	}
	payload := chatRequest{Model: c.model, Messages: messages, Temperature: temperature}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal %s request: %w", c.provider, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create %s request: %w", c.provider, err)
	}
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.referer != "" {
		req.Header.Set("HTTP-Referer", c.referer)
	}
	if c.appName != "" {
		req.Header.Set("X-Title", c.appName)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("%s request failed: %w", c.provider, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, c.maxResponseBytes+1))
	if err != nil {
		return "", fmt.Errorf("read %s response: %w", c.provider, err)
	}
	if int64(len(data)) > c.maxResponseBytes {
		return "", fmt.Errorf("%s response too large", c.provider)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("%s HTTP status %d", c.provider, resp.StatusCode)
	}
	var out chatResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return "", fmt.Errorf("decode %s response: %w", c.provider, err)
	}
	if len(out.Choices) == 0 || strings.TrimSpace(out.Choices[0].Message.Content) == "" {
		return "", ErrInvalidOutput
	}
	return out.Choices[0].Message.Content, nil
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

const transactionSystemPrompt = "Convert Vietnamese personal-finance messages to strict JSON. Return ONLY one object with keys: type (expense or income), category, amount, note. Category is a concise semantic tag for display in parentheses, preferably one of: food, drink, groceries, transport, housing, utilities, shopping, entertainment, health, education, travel, salary, income, other. Do not copy the full message into category. Amount is an integer Vietnamese dong. Understand Vietnamese shorthand amounts: 1tr5=1500000, 1.5tr=1500000, 1500k=1500000, 2k5=2500, 144tr300=144300000. If unsure return {\"error\":\"unknown\"}."

func truncateRunes(s string, max int) string {
	runes := []rune(s)
	if max <= 0 || len(runes) <= max {
		return s
	}
	return string(runes[:max-1]) + "…"
}
