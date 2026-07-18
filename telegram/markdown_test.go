package telegram

import (
	"errors"
	"testing"
)

func TestMarkdownV2EscapesDynamicText(t *testing.T) {
	input := "Ăn tối (pizza) - 150.000₫!"
	want := "Ăn tối \\(pizza\\) \\- 150\\.000₫\\!"
	if got := markdownV2(input); got != want {
		t.Fatalf("markdownV2() = %q, want %q", got, want)
	}
}

func TestIsTelegramParseError(t *testing.T) {
	if !isTelegramParseError(errors.New("Bad Request: can't parse entities")) {
		t.Fatal("parse error not detected")
	}
	if isTelegramParseError(errors.New("network down")) {
		t.Fatal("non-parse error detected")
	}
}
