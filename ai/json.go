package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/dtonair/money-bot/domain"
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
