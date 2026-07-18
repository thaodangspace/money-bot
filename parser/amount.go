package parser

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

var amountTokenPattern = regexp.MustCompile(`^([0-9][0-9.,]*)(k|tr|m|đ|d)?([0-9]*)$`)

var ErrInvalidAmount = errors.New("invalid amount")

func ParseAmount(input string) (int64, error) {
	token := strings.ToLower(strings.TrimSpace(input))
	token = strings.ReplaceAll(token, " ", "")
	if token == "" {
		return 0, ErrInvalidAmount
	}
	match := amountTokenPattern.FindStringSubmatch(token)
	if match == nil {
		return 0, fmt.Errorf("%w: malformed token", ErrInvalidAmount)
	}
	numberPart, suffix, remainder := match[1], match[2], match[3]
	multiplier, compoundOK := suffixMultiplier(suffix)
	if suffix == "" {
		compoundOK = false
	}

	if remainder != "" {
		if !compoundOK || strings.ContainsAny(numberPart, ".,") {
			return 0, fmt.Errorf("%w: malformed compound token", ErrInvalidAmount)
		}
		main, err := parsePlainDigits(numberPart)
		if err != nil {
			return 0, err
		}
		base, err := checkedMul(main, multiplier)
		if err != nil {
			return 0, err
		}
		scale, err := pow10(len(remainder))
		if err != nil || multiplier%scale != 0 {
			return 0, fmt.Errorf("%w: compound precision below one dong", ErrInvalidAmount)
		}
		rem, err := parsePlainDigits(remainder)
		if err != nil {
			return 0, err
		}
		fraction, err := checkedMul(rem, multiplier/scale)
		if err != nil {
			return 0, err
		}
		amount, err := checkedAdd(base, fraction)
		if err != nil {
			return 0, err
		}
		return positiveAmount(amount)
	}

	main, err := parseNumberPart(numberPart, suffix, multiplier)
	if err != nil {
		return 0, err
	}
	return positiveAmount(main)
}

func suffixMultiplier(suffix string) (int64, bool) {
	switch suffix {
	case "k":
		return 1_000, true
	case "tr", "m":
		return 1_000_000, true
	case "đ", "d", "":
		return 1, false
	default:
		return 0, false
	}
}

func parseNumberPart(numberPart, suffix string, multiplier int64) (int64, error) {
	if !strings.ContainsAny(numberPart, ".,") {
		main, err := parsePlainDigits(numberPart)
		if err != nil {
			return 0, err
		}
		return checkedMul(main, multiplier)
	}
	if groupedThousands(numberPart) {
		main, err := parsePlainDigits(removeSeparators(numberPart))
		if err != nil {
			return 0, err
		}
		return checkedMul(main, multiplier)
	}
	if suffix == "" || suffix == "đ" || suffix == "d" {
		return 0, fmt.Errorf("%w: fractional dong", ErrInvalidAmount)
	}
	sep := decimalSeparator(numberPart)
	if sep == 0 {
		return 0, fmt.Errorf("%w: malformed separator", ErrInvalidAmount)
	}
	parts := strings.Split(numberPart, string(sep))
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return 0, fmt.Errorf("%w: malformed decimal", ErrInvalidAmount)
	}
	for _, part := range parts {
		if !onlyDigits(part) {
			return 0, fmt.Errorf("%w: malformed decimal", ErrInvalidAmount)
		}
	}
	numerator, err := parsePlainDigits(parts[0] + parts[1])
	if err != nil {
		return 0, err
	}
	product, err := checkedMul(numerator, multiplier)
	if err != nil {
		return 0, err
	}
	scale, err := pow10(len(parts[1]))
	if err != nil || product%scale != 0 {
		return 0, fmt.Errorf("%w: fractional dong", ErrInvalidAmount)
	}
	return product / scale, nil
}

func groupedThousands(s string) bool {
	var sep rune
	groupLen := 0
	groups := 0
	for i, r := range s {
		switch r {
		case '.', ',':
			if sep == 0 {
				sep = r
			} else if sep != r {
				return false
			}
			if groups == 0 {
				if groupLen < 1 || groupLen > 3 {
					return false
				}
			} else if groupLen != 3 {
				return false
			}
			groups++
			groupLen = 0
		default:
			if r < '0' || r > '9' {
				return false
			}
			groupLen++
		}
		_ = i
	}
	return sep != 0 && groups > 0 && groupLen == 3
}

func decimalSeparator(s string) rune {
	var found rune
	for _, r := range s {
		if r != '.' && r != ',' {
			continue
		}
		if found != 0 {
			return 0
		}
		found = r
	}
	return found
}

func removeSeparators(s string) string {
	s = strings.ReplaceAll(s, ".", "")
	return strings.ReplaceAll(s, ",", "")
}

func parsePlainDigits(s string) (int64, error) {
	if s == "" || !onlyDigits(s) {
		return 0, fmt.Errorf("%w: expected digits", ErrInvalidAmount)
	}
	value, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%w: %v", ErrInvalidAmount, err)
	}
	return value, nil
}

func onlyDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func checkedMul(a, b int64) (int64, error) {
	if a < 0 || b < 0 {
		return 0, fmt.Errorf("%w: negative", ErrInvalidAmount)
	}
	if a != 0 && b > math.MaxInt64/a {
		return 0, fmt.Errorf("%w: overflow", ErrInvalidAmount)
	}
	return a * b, nil
}

func checkedAdd(a, b int64) (int64, error) {
	if a > math.MaxInt64-b {
		return 0, fmt.Errorf("%w: overflow", ErrInvalidAmount)
	}
	return a + b, nil
}

func pow10(n int) (int64, error) {
	if n < 0 || n > 18 {
		return 0, fmt.Errorf("%w: precision overflow", ErrInvalidAmount)
	}
	var v int64 = 1
	for i := 0; i < n; i++ {
		v *= 10
	}
	return v, nil
}

func positiveAmount(amount int64) (int64, error) {
	if amount <= 0 {
		return 0, fmt.Errorf("%w: amount must be positive", ErrInvalidAmount)
	}
	return amount, nil
}
