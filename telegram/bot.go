package telegram

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

type BotAPI interface {
	Send(c tgbotapi.Chattable) (tgbotapi.Message, error)
	Request(c tgbotapi.Chattable) (*tgbotapi.APIResponse, error)
	GetUpdates(config tgbotapi.UpdateConfig) ([]tgbotapi.Update, error)
	GetFileDirectURL(fileID string) (string, error)
}

type MessengerAdapter struct {
	bot BotAPI
}

func NewMessengerAdapter(bot BotAPI) *MessengerAdapter { return &MessengerAdapter{bot: bot} }

func (m *MessengerAdapter) SendMessage(_ context.Context, chatID int64, text string, keyboard InlineKeyboard) error {
	msg := tgbotapi.NewMessage(chatID, markdownV2(text))
	msg.ParseMode = markdownParseMode
	if len(keyboard) > 0 {
		msg.ReplyMarkup = toTelegramKeyboard(keyboard)
	}
	_, err := m.bot.Send(msg)
	if err != nil && isTelegramParseError(err) {
		msg.Text = text
		msg.ParseMode = ""
		_, err = m.bot.Send(msg)
	}
	return err
}

func (m *MessengerAdapter) AnswerCallback(_ context.Context, callbackID, text string) error {
	_, err := m.bot.Request(tgbotapi.NewCallback(callbackID, text))
	return err
}

func NewRealBot(token string) (*tgbotapi.BotAPI, error) {
	if token == "" {
		return nil, fmt.Errorf("telegram token is required")
	}
	bot, err := tgbotapi.NewBotAPIWithClient(token, tgbotapi.APIEndpoint, newTelegramHTTPClient())
	if err != nil {
		return nil, fmt.Errorf("initialize telegram bot: %s", redactTelegramToken(err.Error()))
	}
	return bot, nil
}

const (
	DefaultHTTPTimeout    = 60 * time.Second
	DefaultPollingTimeout = 30 * time.Second
	defaultRetryDelay     = 3 * time.Second
)

func newTelegramHTTPClient() *http.Client {
	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = func(ctx context.Context, _ string, addr string) (net.Conn, error) {
		return dialer.DialContext(ctx, "tcp4", addr)
	}
	return &http.Client{
		Timeout:   DefaultHTTPTimeout,
		Transport: transport,
	}
}

func RunPolling(ctx context.Context, bot BotAPI, handler *Handler, logger *slog.Logger, updateTimeout time.Duration) error {
	if logger == nil {
		logger = slog.Default()
	}
	if updateTimeout <= 0 {
		updateTimeout = 30 * time.Second
	}
	config := tgbotapi.NewUpdate(0)
	config.Timeout = int(DefaultPollingTimeout / time.Second)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}

		updates, err := bot.GetUpdates(config)
		if err != nil {
			retryDelay := defaultRetryDelay
			var telegramErr tgbotapi.Error
			if errors.As(err, &telegramErr) && telegramErr.RetryAfter > 0 {
				retryDelay = time.Duration(telegramErr.RetryAfter) * time.Second
				logger.Warn("get telegram updates failed", "error", redactTelegramToken(err.Error()), "telegram_error_code", telegramErr.Code, "retry_after", retryDelay)
			} else {
				logger.Warn("get telegram updates failed", "error", redactTelegramToken(err.Error()), "retry_after", retryDelay)
			}
			timer := time.NewTimer(retryDelay)
			select {
			case <-ctx.Done():
				if !timer.Stop() {
					<-timer.C
				}
				return ctx.Err()
			case <-timer.C:
			}
			continue
		}

		for _, update := range updates {
			if update.UpdateID < config.Offset {
				continue
			}
			config.Offset = update.UpdateID + 1
			converted, ok := convertUpdate(update)
			if !ok {
				continue
			}
			updateCtx, cancel := context.WithTimeout(ctx, updateTimeout)
			err := handler.HandleUpdate(updateCtx, converted)
			cancel()
			if err != nil {
				logger.Warn("handle telegram update", "update_id", converted.ID, "error", redactTelegramToken(err.Error()))
			}
		}
	}
}

func redactTelegramToken(message string) string {
	const marker = "/bot"
	for searchFrom := 0; searchFrom < len(message); {
		markerOffset := strings.Index(message[searchFrom:], marker)
		if markerOffset < 0 {
			break
		}
		tokenStart := searchFrom + markerOffset + len(marker)
		tokenEndOffset := strings.IndexByte(message[tokenStart:], '/')
		if tokenEndOffset < 0 {
			break
		}
		tokenEnd := tokenStart + tokenEndOffset
		message = message[:tokenStart] + "[REDACTED]" + message[tokenEnd:]
		searchFrom = tokenStart + len("[REDACTED]")
	}
	return message
}

func convertUpdate(update tgbotapi.Update) (Update, bool) {
	if update.Message != nil && update.Message.From != nil {
		message := &Message{
			ChatID:       update.Message.Chat.ID,
			UserID:       update.Message.From.ID,
			Text:         update.Message.Text,
			Caption:      update.Message.Caption,
			MediaGroupID: update.Message.MediaGroupID,
			IsBot:        update.Message.From.IsBot,
		}
		if photo := largestPhoto(update.Message.Photo); photo != nil {
			message.Image = &ImageReference{FileID: photo.FileID, DeclaredSize: int64(photo.FileSize)}
		} else if document := update.Message.Document; document != nil && document.FileID != "" {
			message.Image = &ImageReference{FileID: document.FileID, DeclaredSize: int64(document.FileSize), DeclaredMIME: document.MimeType}
		}
		return Update{ID: update.UpdateID, Message: message}, true
	}
	if update.CallbackQuery != nil && update.CallbackQuery.From != nil && update.CallbackQuery.Message != nil {
		return Update{ID: update.UpdateID, Callback: &Callback{ID: update.CallbackQuery.ID, ChatID: update.CallbackQuery.Message.Chat.ID, UserID: update.CallbackQuery.From.ID, MessageID: update.CallbackQuery.Message.MessageID, Data: update.CallbackQuery.Data}}, true
	}
	return Update{}, false
}

func largestPhoto(photos []tgbotapi.PhotoSize) *tgbotapi.PhotoSize {
	var largest *tgbotapi.PhotoSize
	for i := range photos {
		photo := &photos[i]
		if photo.FileID == "" {
			continue
		}
		if largest == nil || int64(photo.Width)*int64(photo.Height) > int64(largest.Width)*int64(largest.Height) ||
			(int64(photo.Width)*int64(photo.Height) == int64(largest.Width)*int64(largest.Height) && photo.FileSize > largest.FileSize) {
			largest = photo
		}
	}
	return largest
}

func toTelegramKeyboard(keyboard InlineKeyboard) tgbotapi.InlineKeyboardMarkup {
	rows := make([][]tgbotapi.InlineKeyboardButton, 0, len(keyboard))
	for _, row := range keyboard {
		buttons := make([]tgbotapi.InlineKeyboardButton, 0, len(row))
		for _, button := range row {
			buttons = append(buttons, tgbotapi.NewInlineKeyboardButtonData(button.Text, button.Data))
		}
		rows = append(rows, buttons)
	}
	return tgbotapi.NewInlineKeyboardMarkup(rows...)
}
