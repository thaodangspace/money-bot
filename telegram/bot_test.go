package telegram

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/dtonair/money-bot/authz"
	"github.com/dtonair/money-bot/service"
	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

type recordingBot struct {
	sends      []tgbotapi.MessageConfig
	callbacks  []tgbotapi.CallbackConfig
	updates    chan tgbotapi.Update
	stopped    bool
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

func (b *recordingBot) GetUpdatesChan(tgbotapi.UpdateConfig) tgbotapi.UpdatesChannel {
	return b.updates
}
func (b *recordingBot) StopReceivingUpdates() { b.stopped = true }

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
	msgUpdate, ok := convertUpdate(tgbotapi.Update{UpdateID: 9, Message: &tgbotapi.Message{Chat: &tgbotapi.Chat{ID: 42}, From: &tgbotapi.User{ID: 42}, Text: "hello"}})
	if !ok || msgUpdate.ID != 9 || msgUpdate.Message == nil || msgUpdate.Message.Text != "hello" {
		t.Fatalf("message update = %#v ok=%v", msgUpdate, ok)
	}
	cbUpdate, ok := convertUpdate(tgbotapi.Update{UpdateID: 10, CallbackQuery: &tgbotapi.CallbackQuery{ID: "cb", From: &tgbotapi.User{ID: 42}, Message: &tgbotapi.Message{MessageID: 5, Chat: &tgbotapi.Chat{ID: 42}}, Data: callbackSummary}})
	if !ok || cbUpdate.ID != 10 || cbUpdate.Callback == nil || cbUpdate.Callback.Data != callbackSummary || cbUpdate.Callback.MessageID != 5 {
		t.Fatalf("callback update = %#v ok=%v", cbUpdate, ok)
	}
	if _, ok := convertUpdate(tgbotapi.Update{}); ok {
		t.Fatal("empty update converted")
	}
}

func TestRunPollingSequentialAndStops(t *testing.T) {
	updates := make(chan tgbotapi.Update, 2)
	bot := &recordingBot{updates: updates}
	messenger := &fakeMessenger{}
	svc := &fakeService{recordResult: service.Result{Text: "ok"}}
	handler := NewHandler(messenger, svc, authz.New(42), nil)

	updates <- tgbotapi.Update{UpdateID: 1, Message: &tgbotapi.Message{Chat: &tgbotapi.Chat{ID: 42}, From: &tgbotapi.User{ID: 42}, Text: "one"}}
	updates <- tgbotapi.Update{UpdateID: 2, Message: &tgbotapi.Message{Chat: &tgbotapi.Chat{ID: 42}, From: &tgbotapi.User{ID: 42}, Text: "two"}}
	close(updates)

	err := RunPolling(context.Background(), bot, handler, slog.Default(), time.Second)
	if err != nil {
		t.Fatalf("RunPolling() error = %v", err)
	}
	if !bot.stopped || svc.recordCalls != 2 || svc.recordID != 2 {
		t.Fatalf("stopped=%v recordCalls=%d lastID=%d", bot.stopped, svc.recordCalls, svc.recordID)
	}
}

func TestRunPollingCancellation(t *testing.T) {
	updates := make(chan tgbotapi.Update)
	bot := &recordingBot{updates: updates}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := RunPolling(ctx, bot, NewHandler(&fakeMessenger{}, &fakeService{}, authz.New(42), nil), slog.Default(), time.Second)
	if err == nil || !bot.stopped {
		t.Fatalf("RunPolling() err=%v stopped=%v", err, bot.stopped)
	}
}

func TestNewTelegramHTTPClientHasTimeout(t *testing.T) {
	if newTelegramHTTPClient().Timeout != DefaultHTTPTimeout {
		t.Fatalf("timeout = %v", newTelegramHTTPClient().Timeout)
	}
}
