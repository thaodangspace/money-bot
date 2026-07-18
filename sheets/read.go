package sheets

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dtonair/money-bot/domain"
)

var dateHeaderPattern = regexp.MustCompile(`^\d{2}/\d{2}/\d{4}$`)

func (r *Repository) MonthlySummary(ctx context.Context, year int, month time.Month) (domain.MonthlySummary, error) {
	var totalExpenses, totalIncome int64
	var count int

	newRows, err := r.api.GetValues(ctx, r.spreadsheetID, quoteSheet(monthSheet(year, month))+"!A:D")
	if err != nil && !errors.Is(err, ErrSheetNotFound) {
		return domain.MonthlySummary{}, err
	}
	if err == nil {
		exp, inc, n := summarizeFlatRows(newRows, year, month)
		totalExpenses += exp
		totalIncome += inc
		count += n
	}

	legacyRows, err := r.api.GetValues(ctx, r.spreadsheetID, quoteSheet(strconv.Itoa(int(month)))+"!A2:D")
	if err != nil && !errors.Is(err, ErrSheetNotFound) {
		return domain.MonthlySummary{}, err
	}
	if err == nil {
		exp, inc, n := summarizeLegacyRows(legacyRows, year, month)
		totalExpenses += exp
		totalIncome += inc
		count += n
	}

	return domain.NewMonthlySummary(year, month, totalExpenses, totalIncome, count), nil
}

func summarizeFlatRows(rows [][]string, year int, month time.Month) (expenses, income int64, count int) {
	for _, row := range rows {
		if len(row) < 4 {
			continue
		}
		date, ok := parseSheetDate(row[0])
		if !ok || date.Year() != year || date.Month() != month {
			continue
		}
		typ := strings.TrimSpace(strings.ToLower(row[1]))
		amount, ok := parseSheetAmount(row[3])
		if !ok {
			continue
		}
		switch domain.TransactionType(typ) {
		case domain.TransactionExpense:
			expenses += amount
			count++
		case domain.TransactionIncome:
			income += amount
			count++
		}
	}
	return expenses, income, count
}

func summarizeLegacyRows(rows [][]string, year int, month time.Month) (expenses, income int64, count int) {
	include := false
	for _, row := range rows {
		cellA := cell(row, 0)
		if dateHeaderPattern.MatchString(strings.TrimSpace(cellA)) {
			date, ok := parseSheetDate(cellA)
			include = ok && date.Year() == year && date.Month() == month
			continue
		}
		if !include || isEmptyRow(row) {
			continue
		}
		if amount, ok := parseSheetAmount(cell(row, 1)); ok {
			expenses += amount
			count++
		}
		if amount, ok := parseSheetAmount(cell(row, 2)); ok {
			income += amount
			count++
		}
	}
	return expenses, income, count
}

func parseSheetDate(value string) (time.Time, bool) {
	date, err := time.ParseInLocation("02/01/2006", strings.TrimSpace(value), time.UTC)
	return date, err == nil
}

func parseSheetAmount(value string) (int64, bool) {
	clean := strings.TrimSpace(value)
	if clean == "" {
		return 0, false
	}
	clean = strings.ReplaceAll(clean, "₫", "")
	clean = strings.ReplaceAll(clean, " ", "")
	clean = strings.ReplaceAll(clean, ".", "")
	clean = strings.ReplaceAll(clean, ",", "")
	if clean == "" {
		return 0, false
	}
	amount, err := strconv.ParseInt(clean, 10, 64)
	if err != nil || amount <= 0 {
		return 0, false
	}
	return amount, true
}

func isEmptyRow(row []string) bool {
	for _, cell := range row {
		if strings.TrimSpace(cell) != "" {
			return false
		}
	}
	return true
}

func cell(row []string, index int) string {
	if index < 0 || index >= len(row) {
		return ""
	}
	return row[index]
}

func validateFlatRow(row []string) error {
	if len(row) < 4 {
		return fmt.Errorf("flat row requires 4 columns")
	}
	if _, ok := parseSheetDate(row[0]); !ok {
		return fmt.Errorf("invalid flat row date")
	}
	if typ := domain.TransactionType(strings.TrimSpace(strings.ToLower(row[1]))); !typ.Valid() {
		return fmt.Errorf("invalid flat row type")
	}
	if _, ok := parseSheetAmount(row[3]); !ok {
		return fmt.Errorf("invalid flat row amount")
	}
	return nil
}
