package telegram

import (
	"strings"
	"unicode/utf8"
)

const markdownParseMode = "MarkdownV2"

func markdownV2(text string) string {
	var b strings.Builder
	for i := 0; i < len(text); {
		r, size := utf8.DecodeRuneInString(text[i:])
		b.WriteString(escapeMarkdownRune(r))
		i += size
	}
	return b.String()
}

func escapeMarkdownRune(r rune) string {
	switch r {
	case '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!', '\\':
		return "\\" + string(r)
	default:
		return string(r)
	}
}

func isTelegramParseError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "can't parse entities") || strings.Contains(msg, "can't find end of") || strings.Contains(msg, "parse entities")
}
