package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/thaodangspace/money-bot/domain"
)

const (
	maxAICategoryRunes = 120
	maxAINoteRunes     = 500
)

func ParseTransactionJSON(content string) (domain.Transaction, error) {
	object, err := extractSingleJSONObject(content)
	if err != nil {
		return domain.Transaction{}, err
	}
	dec := json.NewDecoder(bytes.NewReader(object))
	dec.DisallowUnknownFields()
	dec.UseNumber()
	var raw struct {
		Error    string      `json:"error"`
		Type     string      `json:"type"`
		Category string      `json:"category"`
		Amount   json.Number `json:"amount"`
		Note     string      `json:"note"`
	}
	if err := dec.Decode(&raw); err != nil {
		return domain.Transaction{}, fmt.Errorf("%w: %v", ErrInvalidOutput, err)
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return domain.Transaction{}, fmt.Errorf("%w: trailing JSON", ErrInvalidOutput)
	}
	if raw.Error != "" {
		return domain.Transaction{}, ErrInvalidOutput
	}
	amount, err := raw.Amount.Int64()
	if err != nil {
		return domain.Transaction{}, fmt.Errorf("%w: amount must be integer", ErrInvalidOutput)
	}
	tx := domain.Transaction{
		Type:     domain.TransactionType(strings.TrimSpace(strings.ToLower(raw.Type))),
		Category: strings.Join(strings.Fields(raw.Category), " "),
		Amount:   amount,
		Note:     strings.Join(strings.Fields(raw.Note), " "),
	}
	if runeLen(tx.Category) > maxAICategoryRunes {
		return domain.Transaction{}, fmt.Errorf("%w: category too long", ErrInvalidOutput)
	}
	if runeLen(tx.Note) > maxAINoteRunes {
		return domain.Transaction{}, fmt.Errorf("%w: note too long", ErrInvalidOutput)
	}
	if err := tx.Validate(); err != nil {
		return domain.Transaction{}, fmt.Errorf("%w: %v", ErrInvalidOutput, err)
	}
	return tx, nil
}

func ParseImageTransactionsJSON(content string) (ImageTransactionExtraction, error) {
	object, err := extractSingleJSONObject(content)
	if err == nil && strings.TrimSpace(content) != string(object) {
		return ImageTransactionExtraction{}, fmt.Errorf("%w: expected one bare JSON object", ErrInvalidOutput)
	}
	if err != nil {
		return ImageTransactionExtraction{}, err
	}
	dec := json.NewDecoder(bytes.NewReader(object))
	dec.DisallowUnknownFields()
	dec.UseNumber()
	var raw struct {
		Error        string `json:"error"`
		Kind         string `json:"kind"`
		Detected     int    `json:"detected"`
		Transactions []struct {
			Type     string      `json:"type"`
			Category string      `json:"category"`
			Amount   json.Number `json:"amount"`
			Note     string      `json:"note"`
			Date     string      `json:"date"`
		} `json:"transactions"`
	}
	if err := dec.Decode(&raw); err != nil {
		return ImageTransactionExtraction{}, fmt.Errorf("%w: %v", ErrInvalidOutput, err)
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return ImageTransactionExtraction{}, fmt.Errorf("%w: trailing JSON", ErrInvalidOutput)
	}
	if raw.Error != "" {
		return ImageTransactionExtraction{}, ErrInvalidOutput
	}
	kind := ImageExtractionKind(strings.TrimSpace(strings.ToLower(raw.Kind)))
	switch kind {
	case ImageExtractionSingleReceipt, ImageExtractionSingleTransfer, ImageExtractionList:
	default:
		return ImageTransactionExtraction{}, fmt.Errorf("%w: invalid image extraction kind", ErrInvalidOutput)
	}
	if raw.Detected <= 0 || raw.Detected > MaxImageTransactions {
		return ImageTransactionExtraction{}, fmt.Errorf("%w: invalid detected count", ErrInvalidOutput)
	}
	if len(raw.Transactions) == 0 || len(raw.Transactions) > MaxImageTransactions {
		return ImageTransactionExtraction{}, fmt.Errorf("%w: invalid transaction count", ErrInvalidOutput)
	}
	if kind != ImageExtractionList && (raw.Detected != 1 || len(raw.Transactions) != 1) {
		return ImageTransactionExtraction{}, fmt.Errorf("%w: single extraction must contain one transaction", ErrInvalidOutput)
	}
	if kind == ImageExtractionList && raw.Detected != len(raw.Transactions) {
		return ImageTransactionExtraction{}, fmt.Errorf("%w: incomplete transaction list", ErrInvalidOutput)
	}

	transactions := make([]domain.Transaction, 0, len(raw.Transactions))
	seen := make(map[string]struct{}, len(raw.Transactions))
	for _, item := range raw.Transactions {
		amount, err := item.Amount.Int64()
		if err != nil {
			return ImageTransactionExtraction{}, fmt.Errorf("%w: amount must be integer", ErrInvalidOutput)
		}
		tx := domain.Transaction{
			Type:     domain.TransactionType(strings.TrimSpace(strings.ToLower(item.Type))),
			Category: strings.Join(strings.Fields(item.Category), " "),
			Amount:   amount,
			Note:     strings.Join(strings.Fields(item.Note), " "),
		}
		if runeLen(tx.Category) > maxAICategoryRunes {
			return ImageTransactionExtraction{}, fmt.Errorf("%w: category too long", ErrInvalidOutput)
		}
		if runeLen(tx.Note) > maxAINoteRunes {
			return ImageTransactionExtraction{}, fmt.Errorf("%w: note too long", ErrInvalidOutput)
		}
		if strings.TrimSpace(item.Date) != "" {
			date, err := time.Parse("2006-01-02", strings.TrimSpace(item.Date))
			if err != nil {
				return ImageTransactionExtraction{}, fmt.Errorf("%w: invalid date", ErrInvalidOutput)
			}
			if date.After(time.Now().UTC().Add(48 * time.Hour)) {
				return ImageTransactionExtraction{}, fmt.Errorf("%w: future date", ErrInvalidOutput)
			}
			tx.Date = date
		}
		if err := tx.Validate(); err != nil {
			return ImageTransactionExtraction{}, fmt.Errorf("%w: %v", ErrInvalidOutput, err)
		}
		key := fmt.Sprintf("%s\x00%s\x00%d\x00%s\x00%s", tx.Type, tx.Category, tx.Amount, tx.Note, tx.Date.Format("2006-01-02"))
		if _, ok := seen[key]; ok {
			return ImageTransactionExtraction{}, fmt.Errorf("%w: duplicate transaction", ErrInvalidOutput)
		}
		seen[key] = struct{}{}
		transactions = append(transactions, tx)
	}
	return ImageTransactionExtraction{Kind: kind, Transactions: transactions, Detected: raw.Detected}, nil
}

func extractSingleJSONObject(content string) ([]byte, error) {
	objects := findJSONObjects(content)
	if len(objects) != 1 {
		return nil, fmt.Errorf("%w: expected exactly one JSON object, got %d", ErrInvalidOutput, len(objects))
	}
	return []byte(objects[0]), nil
}

func findJSONObjects(content string) []string {
	var objects []string
	inString := false
	escape := false
	depth := 0
	start := -1
	for i, r := range content {
		if inString {
			if escape {
				escape = false
				continue
			}
			switch r {
			case '\\':
				escape = true
			case '"':
				inString = false
			}
			continue
		}
		switch r {
		case '"':
			inString = true
		case '{':
			if depth == 0 {
				start = i
			}
			depth++
		case '}':
			if depth > 0 {
				depth--
				if depth == 0 && start >= 0 {
					objects = append(objects, content[start:i+1])
					start = -1
				}
			}
		}
	}
	return objects
}

func decodeOneObject(data []byte, out any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("trailing JSON")
	}
	return nil
}

func runeLen(s string) int { return len([]rune(s)) }
