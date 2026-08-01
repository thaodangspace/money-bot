package telegram

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/thaodangspace/money-bot/authz"
	"github.com/thaodangspace/money-bot/service"
)

type recordingBot struct {
	sends      []tgbotapi.MessageConfig
	callbacks  []tgbotapi.CallbackConfig
	updates    chan tgbotapi.Update
	updateCfg  tgbotapi.UpdateConfig
	cancel     context.CancelFunc
	updateErr  error
	sendErrs   []error
	requestErr error
}

func (b *recordingBot) Send(c tgbotapi.Chattable) (tgbotapi.Message, error) {
	msg, ok := c.(tgbotapi.MessageConfig)
	if !ok {
		return tgbotapi.Message{}, errors.New("unexpected send")
	}
	b.sends = append(b.sends, msg)
	if len(b.sendErrs) > 0 {
		err := b.sendErrs[0]
		b.sendErrs = b.sendErrs[1:]
		if err != nil {
			return tgbotapi.Message{}, err
		}
	}
	return tgbotapi.Message{MessageID: len(b.sends)}, nil
}

func (b *recordingBot) Request(c tgbotapi.Chattable) (*tgbotapi.APIResponse, error) {
	callback, ok := c.(tgbotapi.CallbackConfig)
	if !ok {
		return nil, errors.New("unexpected request")
	}
	b.callbacks = append(b.callbacks, callback)
	if b.requestErr != nil {
		return nil, b.requestErr
	}
	return &tgbotapi.APIResponse{Ok: true}, nil
}

func (b *recordingBot) GetFileDirectURL(string) (string, error) {
	return "", errors.New("not configured")
}

func (b *recordingBot) GetUpdates(config tgbotapi.UpdateConfig) ([]tgbotapi.Update, error) {
	b.updateCfg = config
	if b.updateErr != nil {
		if b.cancel != nil {
			b.cancel()
		}
		return nil, b.updateErr
	}
	var updates []tgbotapi.Update
	for {
		select {
		case update, ok := <-b.updates:
			if !ok {
				if b.cancel != nil {
					b.cancel()
				}
				return updates, nil
			}
			updates = append(updates, update)
		default:
			return updates, nil
		}
	}
}

func TestMessengerAdapterMarkdownAndFallback(t *testing.T) {
	bot := &recordingBot{}
	m := NewMessengerAdapter(bot)
	if err := m.SendMessage(context.Background(), 42, "Ăn (pizza)", InlineKeyboard{{{Text: "Báo cáo", Data: callbackSummary}}}); err != nil {
		t.Fatal(err)
	}
	if len(bot.sends) != 1 || bot.sends[0].ParseMode != markdownParseMode || !strings.Contains(bot.sends[0].Text, "\\(") || bot.sends[0].ReplyMarkup == nil {
		t.Fatalf("send = %#v", bot.sends)
	}

	bot = &recordingBot{sendErrs: []error{errors.New("Bad Request: can't parse entities")}}
	m = NewMessengerAdapter(bot)
	if err := m.SendMessage(context.Background(), 42, "bad * markdown", nil); err != nil {
		t.Fatal(err)
	}
	if len(bot.sends) != 2 || bot.sends[1].ParseMode != "" || bot.sends[1].Text != "bad * markdown" {
		t.Fatalf("fallback sends = %#v", bot.sends)
	}
}

func TestMessengerAdapterAnswerCallback(t *testing.T) {
	bot := &recordingBot{}
	m := NewMessengerAdapter(bot)
	if err := m.AnswerCallback(context.Background(), "cb", "OK"); err != nil {
		t.Fatal(err)
	}
	if len(bot.callbacks) != 1 || bot.callbacks[0].CallbackQueryID != "cb" || bot.callbacks[0].Text != "OK" {
		t.Fatalf("callbacks = %#v", bot.callbacks)
	}
}

func TestConvertUpdateMessageAndCallback(t *testing.T) {
	msgUpdate, ok := convertUpdate(tgbotapi.Update{UpdateID: 9, Message: &tgbotapi.Message{Chat: &tgbotapi.Chat{ID: 42}, From: &tgbotapi.User{ID: 42}, Text: "hello", Caption: "receipt", Photo: []tgbotapi.PhotoSize{{FileID: "small", Width: 10, Height: 10, FileSize: 10}, {FileID: "large", Width: 20, Height: 20, FileSize: 5}}}})
	if !ok || msgUpdate.ID != 9 || msgUpdate.Message == nil || msgUpdate.Message.Text != "hello" || msgUpdate.Message.Caption != "receipt" || msgUpdate.Message.Image == nil || msgUpdate.Message.Image.FileID != "large" {
		t.Fatalf("message update = %#v ok=%v", msgUpdate, ok)
	}
	docUpdate, ok := convertUpdate(tgbotapi.Update{UpdateID: 11, Message: &tgbotapi.Message{Chat: &tgbotapi.Chat{ID: 42}, From: &tgbotapi.User{ID: 42}, Document: &tgbotapi.Document{FileID: "document", FileSize: 123, MimeType: "image/png"}, MediaGroupID: "album"}})
	if !ok || docUpdate.Message == nil || docUpdate.Message.Image == nil || docUpdate.Message.Image.FileID != "document" || docUpdate.Message.Image.DeclaredSize != 123 || docUpdate.Message.MediaGroupID != "album" {
		t.Fatalf("document update = %#v ok=%v", docUpdate, ok)
	}
	cbUpdate, ok := convertUpdate(tgbotapi.Update{UpdateID: 10, CallbackQuery: &tgbotapi.CallbackQuery{ID: "cb", From: &tgbotapi.User{ID: 42}, Message: &tgbotapi.Message{MessageID: 5, Chat: &tgbotapi.Chat{ID: 42}}, Data: callbackSummary}})
	if !ok || cbUpdate.ID != 10 || cbUpdate.Callback == nil || cbUpdate.Callback.Data != callbackSummary || cbUpdate.Callback.MessageID != 5 {
		t.Fatalf("callback update = %#v ok=%v", cbUpdate, ok)
	}
	if _, ok := convertUpdate(tgbotapi.Update{}); ok {
		t.Fatal("empty update converted")
	}
}

func TestRunPollingProcessesUpdatesSequentially(t *testing.T) {
	updates := make(chan tgbotapi.Update, 2)
	ctx, cancel := context.WithCancel(context.Background())
	bot := &recordingBot{updates: updates, cancel: cancel}
	messenger := &fakeMessenger{}
	svc := &fakeService{recordResult: service.Result{Text: "ok"}}
	handler := NewHandler(messenger, svc, authz.New(42), nil)

	updates <- tgbotapi.Update{UpdateID: 1, Message: &tgbotapi.Message{Chat: &tgbotapi.Chat{ID: 42}, From: &tgbotapi.User{ID: 42}, Text: "one"}}
	updates <- tgbotapi.Update{UpdateID: 2, Message: &tgbotapi.Message{Chat: &tgbotapi.Chat{ID: 42}, From: &tgbotapi.User{ID: 42}, Text: "two"}}
	close(updates)

	err := RunPolling(ctx, bot, handler, slog.Default(), time.Second)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("RunPolling() error = %v", err)
	}
	if svc.recordCalls != 2 || svc.recordID != 2 {
		t.Fatalf("recordCalls=%d lastID=%d", svc.recordCalls, svc.recordID)
	}
	if bot.updateCfg.Timeout != int(DefaultPollingTimeout/time.Second) {
		t.Fatalf("polling timeout = %d", bot.updateCfg.Timeout)
	}
}

func TestRunPollingCancellation(t *testing.T) {
	updates := make(chan tgbotapi.Update)
	bot := &recordingBot{updates: updates}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := RunPolling(ctx, bot, NewHandler(&fakeMessenger{}, &fakeService{}, authz.New(42), nil), slog.Default(), time.Second)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("RunPolling() err=%v", err)
	}
}

func TestRunPollingDoesNotLogTokenBearingHTTPError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	bot := &recordingBot{
		cancel:    cancel,
		updateErr: errors.New(`Post "https://api.telegram.org/botsecret-token/getUpdates": timeout`),
	}
	var logs strings.Builder
	logger := slog.New(slog.NewTextHandler(&logs, nil))

	err := RunPolling(ctx, bot, NewHandler(&fakeMessenger{}, &fakeService{}, authz.New(42), nil), logger, time.Second)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("RunPolling() err=%v", err)
	}
	if strings.Contains(logs.String(), "secret-token") {
		t.Fatalf("log contains Telegram token: %s", logs.String())
	}
	if !strings.Contains(logs.String(), "timeout") {
		t.Fatalf("log omits safe error details: %s", logs.String())
	}
}

func TestRedactTelegramToken(t *testing.T) {
	message := `Post "https://api.telegram.org/bot123456:secret/getUpdates": timeout`
	redacted := redactTelegramToken(message)
	if strings.Contains(redacted, "123456:secret") || !strings.Contains(redacted, "/bot[REDACTED]/getUpdates") {
		t.Fatalf("redacted message = %q", redacted)
	}
}

func TestNewTelegramHTTPClientHasTimeout(t *testing.T) {
	c := newTelegramHTTPClient()
	if c.Timeout != DefaultHTTPTimeout {
		t.Fatalf("timeout = %v", c.Timeout)
	}
	tr, ok := c.Transport.(*http.Transport)
	if !ok {
		t.Fatal("transport is not *http.Transport")
	}
	if tr.DialContext == nil {
		t.Fatal("DialContext is nil")
	}
}
