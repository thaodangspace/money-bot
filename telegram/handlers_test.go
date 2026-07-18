package telegram

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/dtonair/money-bot/authz"
	"github.com/dtonair/money-bot/service"
)

type fakeMessenger struct {
	sends     []sentMessage
	callbacks []string
}

type sentMessage struct {
	chatID   int64
	text     string
	keyboard InlineKeyboard
}

func (f *fakeMessenger) SendMessage(_ context.Context, chatID int64, text string, keyboard InlineKeyboard) error {
	f.sends = append(f.sends, sentMessage{chatID: chatID, text: text, keyboard: keyboard})
	return nil
}

func (f *fakeMessenger) AnswerCallback(_ context.Context, _ string, text string) error {
	f.callbacks = append(f.callbacks, text)
	return nil
}

type fakeService struct {
	recordCalls   int
	recordID      int
	recordText    string
	recordResult  service.Result
	recordErr     error
	summaryCalls  int
	summaryQuery  string
	summaryResult service.Result
	summaryErr    error
}

func (f *fakeService) Record(_ context.Context, updateID int, text string) (service.Result, error) {
	f.recordCalls++
	f.recordID = updateID
	f.recordText = text
	if f.recordResult.Text == "" {
		f.recordResult.Text = "recorded"
	}
	return f.recordResult, f.recordErr
}

func (f *fakeService) Summary(_ context.Context, query string) (service.Result, error) {
	f.summaryCalls++
	f.summaryQuery = query
	if f.summaryResult.Text == "" {
		f.summaryResult.Text = "summary"
	}
	return f.summaryResult, f.summaryErr
}

func (f *fakeService) IsSummaryIntent(text string) bool {
	return strings.Contains(strings.ToLower(text), "chi tiêu tháng này")
}

func setupHandler() (*Handler, *fakeMessenger, *fakeService) {
	m := &fakeMessenger{}
	svc := &fakeService{}
	h := NewHandler(m, svc, authz.New(42), nil)
	return h, m, svc
}

func TestUnauthorizedUserRejectedBeforeService(t *testing.T) {
	h, m, svc := setupHandler()
	err := h.HandleUpdate(context.Background(), Update{ID: 1, Message: &Message{ChatID: 7, UserID: 7, Text: "ăn tối 150k"}})
	if err != nil {
		t.Fatal(err)
	}
	if svc.recordCalls != 0 || svc.summaryCalls != 0 {
		t.Fatalf("service called: record=%d summary=%d", svc.recordCalls, svc.summaryCalls)
	}
	if len(m.sends) != 1 || !strings.Contains(m.sends[0].text, "Không có quyền") {
		t.Fatalf("sends = %#v", m.sends)
	}
}

func TestNonPrivateChatRejected(t *testing.T) {
	h, _, svc := setupHandler()
	if err := h.HandleUpdate(context.Background(), Update{ID: 1, Message: &Message{ChatID: -100, UserID: 42, Text: "ăn tối 150k"}}); err != nil {
		t.Fatal(err)
	}
	if svc.recordCalls != 0 {
		t.Fatalf("record calls = %d", svc.recordCalls)
	}
}

func TestCommands(t *testing.T) {
	h, m, svc := setupHandler()
	for _, cmd := range []string{"/start", "/menu", "/help", "/summary", "/summary@MoneyBot"} {
		if err := h.HandleUpdate(context.Background(), Update{ID: 10, Message: &Message{ChatID: 42, UserID: 42, Text: cmd}}); err != nil {
			t.Fatalf("%s error = %v", cmd, err)
		}
	}
	if len(m.sends) != 5 {
		t.Fatalf("sends = %#v", m.sends)
	}
	if !strings.Contains(m.sends[0].text, "money-bot") || !keyboardHas(m.sends[0].keyboard, "Báo cáo", callbackSummary) {
		t.Fatalf("start send = %#v", m.sends[0])
	}
	if !strings.Contains(m.sends[1].text, "Chọn thao tác") || !keyboardHas(m.sends[1].keyboard, "Trợ giúp", callbackHelp) {
		t.Fatalf("menu send = %#v", m.sends[1])
	}
	if !strings.Contains(m.sends[2].text, "Lệnh hỗ trợ") {
		t.Fatalf("help send = %#v", m.sends[2])
	}
	if svc.summaryCalls != 2 {
		t.Fatalf("summary calls = %d", svc.summaryCalls)
	}
}

func TestSummaryCommandPassesMonthArgument(t *testing.T) {
	h, _, svc := setupHandler()
	if err := h.HandleUpdate(context.Background(), Update{ID: 11, Message: &Message{ChatID: 42, UserID: 42, Text: "/summary tháng 5"}}); err != nil {
		t.Fatal(err)
	}
	if svc.summaryCalls != 1 || svc.summaryQuery != "tháng 5" {
		t.Fatalf("summary calls=%d query=%q", svc.summaryCalls, svc.summaryQuery)
	}
}

func TestOrdinaryMessageAndSummaryIntent(t *testing.T) {
	h, m, svc := setupHandler()
	if err := h.HandleUpdate(context.Background(), Update{ID: 99, Message: &Message{ChatID: 42, UserID: 42, Text: "ăn tối 150k"}}); err != nil {
		t.Fatal(err)
	}
	if svc.recordCalls != 1 || svc.recordID != 99 || svc.recordText != "ăn tối 150k" || m.sends[0].text != "recorded" {
		t.Fatalf("record svc=%#v sends=%#v", svc, m.sends)
	}
	if err := h.HandleUpdate(context.Background(), Update{ID: 100, Message: &Message{ChatID: 42, UserID: 42, Text: "chi tiêu tháng này"}}); err != nil {
		t.Fatal(err)
	}
	if svc.summaryCalls != 1 || svc.summaryQuery != "chi tiêu tháng này" || len(m.sends) != 2 || m.sends[1].text != "summary" {
		t.Fatalf("summary svc=%#v sends=%#v", svc, m.sends)
	}
}

func TestCallbacksAnswered(t *testing.T) {
	h, m, svc := setupHandler()
	for _, data := range []string{callbackMenu, callbackHelp, callbackSummary, "unknown"} {
		if err := h.HandleUpdate(context.Background(), Update{Callback: &Callback{ID: "cb", ChatID: 42, UserID: 42, Data: data}}); err != nil {
			t.Fatalf("callback %s error = %v", data, err)
		}
	}
	if len(m.callbacks) != 4 || m.callbacks[0] != "OK" || m.callbacks[3] != "Không rõ thao tác" {
		t.Fatalf("callbacks = %#v", m.callbacks)
	}
	if svc.summaryCalls != 1 {
		t.Fatalf("summary calls = %d", svc.summaryCalls)
	}
}

func TestServiceErrorsStillSendUserMessage(t *testing.T) {
	h, m, svc := setupHandler()
	svc.recordResult = service.Result{Text: "Không lưu được"}
	svc.recordErr = errors.New("sheets down")
	err := h.HandleUpdate(context.Background(), Update{ID: 1, Message: &Message{ChatID: 42, UserID: 42, Text: "ăn tối 150k"}})
	if err == nil || !strings.Contains(err.Error(), "sheets down") {
		t.Fatalf("HandleUpdate() error = %v", err)
	}
	if len(m.sends) != 1 || m.sends[0].text != "Không lưu được" {
		t.Fatalf("sends = %#v", m.sends)
	}
}

func TestBotAndEmptyMessagesIgnored(t *testing.T) {
	h, _, svc := setupHandler()
	for _, msg := range []Message{{ChatID: 42, UserID: 42, Text: "", IsBot: false}, {ChatID: 42, UserID: 42, Text: "hello", IsBot: true}} {
		if err := h.HandleUpdate(context.Background(), Update{ID: 1, Message: &msg}); err != nil {
			t.Fatal(err)
		}
	}
	if svc.recordCalls != 0 || svc.summaryCalls != 0 {
		t.Fatalf("service calls record=%d summary=%d", svc.recordCalls, svc.summaryCalls)
	}
}

func TestChunkedSendPutsKeyboardOnLastChunk(t *testing.T) {
	h, m, _ := setupHandler()
	long := strings.Repeat("x", DefaultMaxMessageRunes+1)
	if err := h.sendChunks(context.Background(), 42, long, quickMenuKeyboard()); err != nil {
		t.Fatal(err)
	}
	if len(m.sends) != 2 || len(m.sends[0].keyboard) != 0 || len(m.sends[1].keyboard) == 0 {
		t.Fatalf("sends = %#v", m.sends)
	}
}

func keyboardHas(keyboard InlineKeyboard, text, data string) bool {
	for _, row := range keyboard {
		for _, button := range row {
			if button.Text == text && button.Data == data {
				return true
			}
		}
	}
	return false
}
