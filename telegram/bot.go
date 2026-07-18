package telegram

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

type BotAPI interface {
	Send(c tgbotapi.Chattable) (tgbotapi.Message, error)
	Request(c tgbotapi.Chattable) (*tgbotapi.APIResponse, error)
	GetUpdatesChan(config tgbotapi.UpdateConfig) tgbotapi.UpdatesChannel
	StopReceivingUpdates()
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
	return tgbotapi.NewBotAPIWithClient(token, tgbotapi.APIEndpoint, newTelegramHTTPClient())
}

const DefaultHTTPTimeout = 60 * time.Second

func newTelegramHTTPClient() *http.Client { return &http.Client{Timeout: DefaultHTTPTimeout} }

func RunPolling(ctx context.Context, bot BotAPI, handler *Handler, logger *slog.Logger, updateTimeout time.Duration) error {
	if logger == nil {
		logger = slog.Default()
	}
	if updateTimeout <= 0 {
		updateTimeout = 30 * time.Second
	}
	updates := bot.GetUpdatesChan(tgbotapi.NewUpdate(0))
	defer bot.StopReceivingUpdates()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case update, ok := <-updates:
			if !ok {
				return nil
			}
			converted, ok := convertUpdate(update)
			if !ok {
				continue
			}
			updateCtx, cancel := context.WithTimeout(ctx, updateTimeout)
			err := handler.HandleUpdate(updateCtx, converted)
			cancel()
			if err != nil {
				logger.Warn("handle telegram update", "update_id", converted.ID, "error", err)
			}
		}
	}
}

func convertUpdate(update tgbotapi.Update) (Update, bool) {
	if update.Message != nil && update.Message.From != nil {
		return Update{ID: update.UpdateID, Message: &Message{ChatID: update.Message.Chat.ID, UserID: update.Message.From.ID, Text: update.Message.Text, IsBot: update.Message.From.IsBot}}, true
	}
	if update.CallbackQuery != nil && update.CallbackQuery.From != nil && update.CallbackQuery.Message != nil {
		return Update{ID: update.UpdateID, Callback: &Callback{ID: update.CallbackQuery.ID, ChatID: update.CallbackQuery.Message.Chat.ID, UserID: update.CallbackQuery.From.ID, MessageID: update.CallbackQuery.Message.MessageID, Data: update.CallbackQuery.Data}}, true
	}
	return Update{}, false
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
