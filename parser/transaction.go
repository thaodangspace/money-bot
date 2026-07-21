package parser

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/thaodangspace/money-bot/domain"
)

const (
	MaxInputRunes    = 2000
	MaxCategoryRunes = 120
	MaxNoteRunes     = 500
)

var (
	ErrNoTransaction = errors.New("transaction not recognized")
	transactionRe    = regexp.MustCompile(`^(.+?)\s+([0-9][0-9.,]*\s*(?:k|tr|m|đ|d)?\d*)(?:\s+(.*))?$`)
)

func ParseTransaction(input string) (domain.Transaction, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return domain.Transaction{}, ErrNoTransaction
	}
	if runeLen(trimmed) > MaxInputRunes {
		return domain.Transaction{}, fmt.Errorf("%w: input too long", ErrNoTransaction)
	}

	txType := domain.TransactionExpense
	text := trimmed
	if withoutPrefix, ok := trimIncomePrefix(text); ok {
		txType = domain.TransactionIncome
		text = strings.TrimSpace(withoutPrefix)
	}
	if text == "" {
		return domain.Transaction{}, ErrNoTransaction
	}

	match := transactionRe.FindStringSubmatch(text)
	if match == nil {
		return domain.Transaction{}, ErrNoTransaction
	}
	category := normalizeText(match[1])
	amountToken := normalizeText(match[2])
	note := ""
	if len(match) > 3 {
		note = normalizeText(match[3])
	}
	if category == "" {
		return domain.Transaction{}, ErrNoTransaction
	}
	if runeLen(category) > MaxCategoryRunes {
		return domain.Transaction{}, fmt.Errorf("%w: category too long", ErrNoTransaction)
	}
	if runeLen(note) > MaxNoteRunes {
		return domain.Transaction{}, fmt.Errorf("%w: note too long", ErrNoTransaction)
	}
	amount, err := ParseAmount(amountToken)
	if err != nil {
		return domain.Transaction{}, err
	}
	tx := domain.Transaction{Category: capitalizeFirst(category), Amount: amount, Note: note, Type: txType}
	if err := tx.Validate(); err != nil {
		return domain.Transaction{}, err
	}
	return tx, nil
}

func trimIncomePrefix(input string) (string, bool) {
	normalized := normalizeForIntent(input)
	prefixes := []string{"thu nhap", "nhan", "thu"}
	for _, prefix := range prefixes {
		if normalized == prefix {
			return "", true
		}
		if strings.HasPrefix(normalized, prefix+" ") {
			return trimLeadingWords(input, len(strings.Fields(prefix))), true
		}
	}
	return input, false
}

func trimLeadingWords(input string, count int) string {
	input = strings.TrimSpace(input)
	for count > 0 && input != "" {
		fields := strings.Fields(input)
		if len(fields) <= 1 {
			return ""
		}
		first := fields[0]
		idx := strings.Index(input, first) + len(first)
		input = strings.TrimSpace(input[idx:])
		count--
	}
	return input
}

func normalizeText(input string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(input)), " ")
}

func capitalizeFirst(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}
	r, size := utf8.DecodeRuneInString(input)
	if r == utf8.RuneError && size == 0 {
		return input
	}
	return string(unicode.ToUpper(r)) + input[size:]
}

func runeLen(s string) int { return len([]rune(s)) }
