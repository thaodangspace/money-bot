package parser

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

type MonthlySummaryPeriod struct {
	Year  int
	Month time.Month
}

var (
	summaryRelativePreviousPattern = regexp.MustCompile(`\bthang\s+(?:truoc|vua\s+roi)\b`)
	summaryCurrentPattern          = regexp.MustCompile(`\bthang\s+nay\b`)
	summaryMonthYearPattern        = regexp.MustCompile(`\b(0?[1-9]|1[0-2])\s*/\s*((?:19|20)\d{2})\b`)
	summaryYearMonthPattern        = regexp.MustCompile(`\b((?:19|20)\d{2})\s*(?:/|\s)\s*(0?[1-9]|1[0-2])\b`)
	summaryNamedMonthPattern       = regexp.MustCompile(`\bthang\s+(0?[1-9]|1[0-2])(?:\s*/?\s*((?:19|20)\d{2}))?\b`)
	summaryBareMonthPattern        = regexp.MustCompile(`^(0?[1-9]|1[0-2])(?:\s*/?\s*((?:19|20)\d{2}))?$`)
)

func ParseMonthlySummaryPeriod(input string, now time.Time) (MonthlySummaryPeriod, bool) {
	normalized := normalizeForIntent(input)
	current := MonthlySummaryPeriod{Year: now.Year(), Month: now.Month()}
	if normalized == "" {
		return current, true
	}
	if strings.HasPrefix(normalized, "/summary") {
		fields := strings.Fields(normalized)
		if len(fields) <= 1 {
			return current, true
		}
		normalized = strings.Join(fields[1:], " ")
	}
	if normalized == "" || summaryCurrentPattern.MatchString(normalized) {
		return current, true
	}
	if summaryRelativePreviousPattern.MatchString(normalized) {
		firstOfCurrentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
		previous := firstOfCurrentMonth.AddDate(0, -1, 0)
		return MonthlySummaryPeriod{Year: previous.Year(), Month: previous.Month()}, true
	}
	if match := summaryMonthYearPattern.FindStringSubmatch(normalized); match != nil {
		return periodFromParts(match[2], match[1])
	}
	if match := summaryYearMonthPattern.FindStringSubmatch(normalized); match != nil {
		return periodFromParts(match[1], match[2])
	}
	if match := summaryNamedMonthPattern.FindStringSubmatch(normalized); match != nil {
		year := strconv.Itoa(now.Year())
		if match[2] != "" {
			year = match[2]
		}
		return periodFromParts(year, match[1])
	}
	if match := summaryBareMonthPattern.FindStringSubmatch(normalized); match != nil {
		year := strconv.Itoa(now.Year())
		if match[2] != "" {
			year = match[2]
		}
		return periodFromParts(year, match[1])
	}
	return MonthlySummaryPeriod{}, false
}

func periodFromParts(yearText, monthText string) (MonthlySummaryPeriod, bool) {
	year, err := strconv.Atoi(yearText)
	if err != nil {
		return MonthlySummaryPeriod{}, false
	}
	month, err := strconv.Atoi(monthText)
	if err != nil || month < 1 || month > 12 {
		return MonthlySummaryPeriod{}, false
	}
	return MonthlySummaryPeriod{Year: year, Month: time.Month(month)}, true
}
