package telegram

import (
	"context"

	"github.com/thaodangspace/money-bot/service"
)

type Messenger interface {
	SendMessage(ctx context.Context, chatID int64, text string, keyboard InlineKeyboard) error
	AnswerCallback(ctx context.Context, callbackID, text string) error
}

type MoneyService interface {
	Record(ctx context.Context, updateID int, text string) (service.Result, error)
	Summary(ctx context.Context, query string) (service.Result, error)
	IsSummaryIntent(text string) bool
}

type InlineKeyboard [][]Button

type Button struct {
	Text string
	Data string
}

type Update struct {
	ID       int
	Message  *Message
	Callback *Callback
}

type Message struct {
	ChatID int64
	UserID int64
	Text   string
	IsBot  bool
}

type Callback struct {
	ID        string
	ChatID    int64
	UserID    int64
	MessageID int
	Data      string
}
