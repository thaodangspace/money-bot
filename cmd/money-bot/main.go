package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/thaodangspace/money-bot/ai"
	"github.com/thaodangspace/money-bot/authz"
	"github.com/thaodangspace/money-bot/config"
	"github.com/thaodangspace/money-bot/domain"
	"github.com/thaodangspace/money-bot/service"
	"github.com/thaodangspace/money-bot/sheets"
	"github.com/thaodangspace/money-bot/telegram"
)

var (
	makeSheetsAPI = realSheetsAPI
	makeTelegram  = func(token string) (telegram.BotAPI, error) { return telegram.NewRealBot(token) }
	pollTelegram  = telegram.RunPolling
)

func main() {
	if err := run(os.Args[1:], os.Stderr, os.Getenv); err != nil {
		fmt.Fprintf(os.Stderr, "money-bot: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, logWriter io.Writer, getenv func(string) string) error {
	if logWriter == nil {
		logWriter = io.Discard
	}
	fs := flag.NewFlagSet("money-bot", flag.ContinueOnError)
	fs.SetOutput(logWriter)
	configPath := fs.String("config", "config.yaml", "path to YAML config file")
	dryRun := fs.Bool("dry-run", false, "validate config and exit without starting Telegram polling")
	logLevel := fs.String("log-level", "info", "log level: debug, info, warn, error")
	if err := fs.Parse(args); err != nil {
		return err
	}

	logger := slog.New(slog.NewTextHandler(logWriter, &slog.HandlerOptions{Level: parseLogLevel(*logLevel)}))
	slog.SetDefault(logger)
	cfg, err := config.LoadWithEnv(*configPath, getenv)
	if err != nil {
		return err
	}
	guard := authz.New(cfg.Telegram.AllowedUserID)
	if !guard.IsAllowedPrivateChat(cfg.Telegram.AllowedUserID, cfg.Telegram.AllowedUserID) {
		return fmt.Errorf("authorization configuration rejected allowed user")
	}

	if *dryRun {
		logger.Info("configuration validated",
			"timezone", cfg.App.Timezone,
			"telegram_allowed_user_id", cfg.Telegram.AllowedUserID,
			"google_spreadsheet_configured", cfg.Google.SpreadsheetID != "",
			"google_credential_kind", cfg.Google.CredentialSource.Kind,
			"google_metadata_sheet", cfg.Google.MetadataSheet,
			"ai_enabled", cfg.AI.Enabled,
			"ai_provider", cfg.AI.Provider,
			"ai_base_url_configured", cfg.AI.BaseURL != "",
			"ai_api_key_configured", cfg.AI.APIKey != "" || cfg.AI.OpenRouterAPIKey != "",
			"update_timeout", cfg.App.UpdateTimeout.String(),
		)
		return nil
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := runLive(ctx, cfg, guard, logger); err != nil {
		if errors.Is(err, context.Canceled) {
			return nil
		}
		return err
	}
	return nil
}

func runLive(ctx context.Context, cfg *config.Config, guard authz.Authorizer, logger *slog.Logger) error {
	sheetsAPI, err := makeSheetsAPI(ctx, cfg)
	if err != nil {
		return err
	}
	repo, err := sheets.NewRepository(sheetsAPI, cfg.Google.SpreadsheetID, cfg.Google.MetadataSheet, cfg.App.Location)
	if err != nil {
		return err
	}
	aiClient, err := ai.NewFromConfig(cfg.AI)
	if err != nil {
		return err
	}
	var aiParser service.AIParser = aiClient
	var commentator service.Commentator = aiClient
	money, err := service.New(service.Options{
		Location: cfg.App.Location,
		Clock:    service.ClockFunc(func() time.Time { return time.Now() }),
		Ledger:   ledgerAdapter{repo: repo},
		AI:       aiParser,
		Comments: commentator,
	})
	if err != nil {
		return err
	}
	bot, err := makeTelegram(cfg.Telegram.Token)
	if err != nil {
		return err
	}
	handler := telegram.NewHandler(telegram.NewMessengerAdapter(bot), money, guard, logger)
	logger.Info("starting telegram polling", "telegram_allowed_user_id", cfg.Telegram.AllowedUserID)
	return pollTelegram(ctx, bot, handler, logger, cfg.App.UpdateTimeout)
}

func realSheetsAPI(ctx context.Context, cfg *config.Config) (sheets.API, error) {
	opts, err := sheets.ClientOptions(cfg.Google.CredentialSource)
	if err != nil {
		return nil, err
	}
	return sheets.NewClient(ctx, cfg.Google.RequestTimeout, opts...)
}

type ledgerAdapter struct {
	repo *sheets.Repository
}

func (l ledgerAdapter) AppendTransaction(ctx context.Context, tx domain.Transaction) (service.AppendResult, error) {
	result, err := l.repo.AppendTransaction(ctx, tx)
	if err != nil {
		return service.AppendResult{}, err
	}
	status := service.AppendStatus(result.Status)
	return service.AppendResult{Status: status, TargetSheet: result.TargetSheet}, nil
}

func (l ledgerAdapter) MonthlySummary(ctx context.Context, year int, month time.Month) (domain.MonthlySummary, error) {
	return l.repo.MonthlySummary(ctx, year, month)
}

func parseLogLevel(level string) slog.Leveler {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
