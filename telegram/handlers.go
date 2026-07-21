package telegram

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/thaodangspace/money-bot/authz"
)

type Handler struct {
	messenger Messenger
	service   MoneyService
	auth      authz.Authorizer
	logger    *slog.Logger
}

func NewHandler(messenger Messenger, svc MoneyService, authorizer authz.Authorizer, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{messenger: messenger, service: svc, auth: authorizer, logger: logger}
}

func (h *Handler) HandleUpdate(ctx context.Context, update Update) error {
	if update.Message != nil {
		return h.handleMessage(ctx, update.ID, *update.Message)
	}
	if update.Callback != nil {
		return h.handleCallback(ctx, *update.Callback)
	}
	return nil
}

func (h *Handler) handleMessage(ctx context.Context, updateID int, msg Message) error {
	if msg.IsBot || strings.TrimSpace(msg.Text) == "" {
		return nil
	}
	if !h.auth.IsAllowedPrivateChat(msg.UserID, msg.ChatID) {
		_ = h.messenger.SendMessage(ctx, msg.ChatID, "Không có quyền sử dụng bot này.", nil)
		return nil
	}
	text := strings.TrimSpace(msg.Text)
	if strings.HasPrefix(text, "/") {
		return h.handleCommand(ctx, msg.ChatID, text)
	}
	if h.service.IsSummaryIntent(text) {
		return h.sendSummary(ctx, msg.ChatID, text)
	}
	return h.sendRecord(ctx, updateID, msg.ChatID, text)
}

func (h *Handler) handleCallback(ctx context.Context, cb Callback) error {
	if !h.auth.IsAllowedPrivateChat(cb.UserID, cb.ChatID) {
		return h.messenger.AnswerCallback(ctx, cb.ID, "Không có quyền")
	}
	switch cb.Data {
	case callbackSummary:
		if err := h.messenger.AnswerCallback(ctx, cb.ID, "OK"); err != nil {
			return err
		}
		return h.sendSummary(ctx, cb.ChatID, "")
	case callbackHelp:
		if err := h.messenger.AnswerCallback(ctx, cb.ID, "OK"); err != nil {
			return err
		}
		return h.sendChunks(ctx, cb.ChatID, helpText(), nil)
	case callbackMenu:
		if err := h.messenger.AnswerCallback(ctx, cb.ID, "OK"); err != nil {
			return err
		}
		return h.sendChunks(ctx, cb.ChatID, quickMenuText(), quickMenuKeyboard())
	default:
		return h.messenger.AnswerCallback(ctx, cb.ID, "Không rõ thao tác")
	}
}

func (h *Handler) handleCommand(ctx context.Context, chatID int64, text string) error {
	switch commandName(text) {
	case "start":
		return h.sendChunks(ctx, chatID, startText(), startKeyboard())
	case "menu":
		return h.sendChunks(ctx, chatID, quickMenuText(), quickMenuKeyboard())
	case "summary":
		return h.sendSummary(ctx, chatID, commandArgs(text))
	case "help":
		return h.sendChunks(ctx, chatID, helpText(), nil)
	default:
		return h.sendChunks(ctx, chatID, "Không rõ lệnh. Dùng /help để xem hướng dẫn.", nil)
	}
}

func (h *Handler) sendRecord(ctx context.Context, updateID int, chatID int64, text string) error {
	result, err := h.service.Record(ctx, updateID, text)
	if sendErr := h.sendChunks(ctx, chatID, result.Text, nil); sendErr != nil {
		return sendErr
	}
	return err
}

func (h *Handler) sendSummary(ctx context.Context, chatID int64, query string) error {
	result, err := h.service.Summary(ctx, query)
	if sendErr := h.sendChunks(ctx, chatID, result.Text, nil); sendErr != nil {
		return sendErr
	}
	return err
}

func (h *Handler) sendChunks(ctx context.Context, chatID int64, text string, keyboard InlineKeyboard) error {
	chunks := ChunkText(text, DefaultMaxMessageRunes)
	if len(chunks) == 0 {
		chunks = []string{""}
	}
	for i, chunk := range chunks {
		var kb InlineKeyboard
		if i == len(chunks)-1 {
			kb = keyboard
		}
		if err := h.messenger.SendMessage(ctx, chatID, chunk, kb); err != nil {
			return fmt.Errorf("send telegram message: %w", err)
		}
	}
	return nil
}

func commandName(text string) string {
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return ""
	}
	name := strings.TrimPrefix(fields[0], "/")
	if idx := strings.IndexByte(name, '@'); idx >= 0 {
		name = name[:idx]
	}
	return strings.ToLower(name)
}

func commandArgs(text string) string {
	fields := strings.Fields(text)
	if len(fields) <= 1 {
		return ""
	}
	return strings.Join(fields[1:], " ")
}
