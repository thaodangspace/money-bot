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
	PrepareImage(ctx context.Context, updateID int, input service.ImageInput) (service.ImagePreparation, error)
	ConfirmImage(ctx context.Context, token string) (service.Result, error)
	CancelImage(token string) service.Result
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

type ImageReference struct {
	FileID       string
	DeclaredSize int64
	DeclaredMIME string
}

type Message struct {
	ChatID       int64
	UserID       int64
	Text         string
	Caption      string
	Image        *ImageReference
	MediaGroupID string
	IsBot        bool
}

type Callback struct {
	ID        string
	ChatID    int64
	UserID    int64
	MessageID int
	Data      string
}
