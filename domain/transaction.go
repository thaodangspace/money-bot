package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type TransactionType string

const (
	TransactionExpense TransactionType = "expense"
	TransactionIncome  TransactionType = "income"
)

type Transaction struct {
	Category        string
	Amount          int64
	Note            string
	Type            TransactionType
	Date            time.Time
	SourceUpdateID  int
	OriginalMessage string
}

func (t TransactionType) Valid() bool {
	switch t {
	case TransactionExpense, TransactionIncome:
		return true
	default:
		return false
	}
}

func (t Transaction) Content() string {
	category := normalizeContentText(t.Category)
	if original := normalizeContentText(t.OriginalMessage); original != "" {
		if category != "" {
			return "(" + category + ") " + original
		}
		return original
	}
	parts := []string{category}
	if note := normalizeContentText(t.Note); note != "" {
		parts = append(parts, note)
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

func normalizeContentText(input string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(input)), " ")
}

func (t Transaction) Validate() error {
	var errs []error
	if !t.Type.Valid() {
		errs = append(errs, fmt.Errorf("transaction type must be %q or %q", TransactionExpense, TransactionIncome))
	}
	if strings.TrimSpace(t.Category) == "" {
		errs = append(errs, errors.New("transaction category is required"))
	}
	if t.Amount <= 0 {
		errs = append(errs, errors.New("transaction amount must be positive"))
	}
	return errors.Join(errs...)
}
