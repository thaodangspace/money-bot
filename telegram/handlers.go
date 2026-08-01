package telegram

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/thaodangspace/money-bot/authz"
	"github.com/thaodangspace/money-bot/service"
)

const (
	callbackImageConfirmPrefix = "img:ok:"
	callbackImageCancelPrefix  = "img:no:"
)

type Handler struct {
	messenger    Messenger
	service      MoneyService
	imageFetcher ImageFetcher
	auth         authz.Authorizer
	logger       *slog.Logger
}

type HandlerOption func(*Handler)

func WithImageFetcher(fetcher ImageFetcher) HandlerOption {
	return func(handler *Handler) { handler.imageFetcher = fetcher }
}

func NewHandler(messenger Messenger, svc MoneyService, authorizer authz.Authorizer, logger *slog.Logger, options ...HandlerOption) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	handler := &Handler{messenger: messenger, service: svc, auth: authorizer, logger: logger}
	for _, option := range options {
		if option != nil {
			option(handler)
		}
	}
	return handler
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
	if msg.IsBot {
		return nil
	}
	if !h.auth.IsAllowedPrivateChat(msg.UserID, msg.ChatID) {
		_ = h.messenger.SendMessage(ctx, msg.ChatID, "Không có quyền sử dụng bot này.", nil)
		return nil
	}
	if msg.Image != nil {
		return h.handleImage(ctx, updateID, msg)
	}
	text := strings.TrimSpace(msg.Text)
	if text == "" {
		return nil
	}
	if strings.HasPrefix(text, "/") {
		return h.handleCommand(ctx, msg.ChatID, text)
	}
	if h.service.IsSummaryIntent(text) {
		return h.sendSummary(ctx, msg.ChatID, text)
	}
	return h.sendRecord(ctx, updateID, msg.ChatID, text)
}

func (h *Handler) handleImage(ctx context.Context, updateID int, msg Message) error {
	if msg.MediaGroupID != "" {
		return h.sendChunks(ctx, msg.ChatID, "⚠️ Hiện bot chỉ hỗ trợ một ảnh cho mỗi giao dịch. Vui lòng gửi ảnh riêng lẻ.", nil)
	}
	if h.imageFetcher == nil {
		return h.sendChunks(ctx, msg.ChatID, "❌ Tính năng xử lý ảnh hiện chưa sẵn sàng. Vui lòng thử lại sau.", nil)
	}
	image, err := h.imageFetcher.FetchImage(ctx, *msg.Image)
	if err != nil {
		if sendErr := h.sendChunks(ctx, msg.ChatID, "❌ Không thể đọc ảnh. Vui lòng gửi JPEG, PNG hoặc WebP rõ nét, tối đa 5 MiB.", nil); sendErr != nil {
			return sendErr
		}
		return err
	}
	prepared, err := h.service.PrepareImage(ctx, updateID, service.ImageInput{Caption: msg.Caption, MIMEType: image.MIMEType, Data: image.Data})
	if sendErr := h.sendChunks(ctx, msg.ChatID, prepared.Text, imageConfirmationKeyboard(prepared.Token)); sendErr != nil {
		return sendErr
	}
	return err
}

func (h *Handler) handleCallback(ctx context.Context, cb Callback) error {
	if !h.auth.IsAllowedPrivateChat(cb.UserID, cb.ChatID) {
		return h.messenger.AnswerCallback(ctx, cb.ID, "Không có quyền")
	}
	if token, ok := imageCallbackToken(cb.Data, callbackImageConfirmPrefix); ok {
		if err := h.messenger.AnswerCallback(ctx, cb.ID, "Đang lưu"); err != nil {
			return err
		}
		result, err := h.service.ConfirmImage(ctx, token)
		if sendErr := h.sendChunks(ctx, cb.ChatID, result.Text, nil); sendErr != nil {
			return sendErr
		}
		return err
	}
	if token, ok := imageCallbackToken(cb.Data, callbackImageCancelPrefix); ok {
		if err := h.messenger.AnswerCallback(ctx, cb.ID, "Đã hủy"); err != nil {
			return err
		}
		return h.sendChunks(ctx, cb.ChatID, h.service.CancelImage(token).Text, nil)
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

func imageConfirmationKeyboard(token string) InlineKeyboard {
	if token == "" {
		return nil
	}
	confirm := callbackImageConfirmPrefix + token
	cancel := callbackImageCancelPrefix + token
	if len(confirm) > 64 || len(cancel) > 64 {
		return nil
	}
	return InlineKeyboard{{
		{Text: "Xác nhận", Data: confirm},
		{Text: "Hủy", Data: cancel},
	}}
}

func imageCallbackToken(data, prefix string) (string, bool) {
	token, ok := strings.CutPrefix(data, prefix)
	return token, ok && token != "" && len(data) <= 64
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
