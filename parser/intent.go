package parser

import (
	"regexp"
	"strings"
)

var summaryIntentPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\bchi\s*tieu\s*thang\s*nay\b`),
	regexp.MustCompile(`\btong\s*chi\s*thang\s*nay\b`),
	regexp.MustCompile(`\bxem\s*chi\s*thang\s*nay\b`),
	regexp.MustCompile(`\bthong\s*ke\s*thang\s*nay\b`),
	regexp.MustCompile(`\bbao\s*cao\s*thang\s*nay\b`),
	regexp.MustCompile(`\bbao\s*cao\s*chi\s*tieu\b`),
	regexp.MustCompile(`\bchi\s*tieu\s*thang\s+(?:0?[1-9]|1[0-2])(?:\b|/)`),
	regexp.MustCompile(`\btong\s*chi\s*thang\s+(?:0?[1-9]|1[0-2])(?:\b|/)`),
	regexp.MustCompile(`\bxem\s*chi\s*thang\s+(?:0?[1-9]|1[0-2])(?:\b|/)`),
	regexp.MustCompile(`\bthong\s*ke\s*thang\s+(?:0?[1-9]|1[0-2])(?:\b|/)`),
	regexp.MustCompile(`\bbao\s*cao\s*thang\s+(?:0?[1-9]|1[0-2])(?:\b|/)`),
	regexp.MustCompile(`^/summary(?:\s|$)`),
}

func DetectMonthlySummaryIntent(input string) bool {
	normalized := normalizeForIntent(input)
	if normalized == "" {
		return false
	}
	for _, pattern := range summaryIntentPatterns {
		if pattern.MatchString(normalized) {
			return true
		}
	}
	return false
}

func normalizeForIntent(input string) string {
	input = strings.ToLower(strings.TrimSpace(input))
	var b strings.Builder
	space := false
	for _, r := range input {
		r = foldVietnameseRune(r)
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '/' {
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			space = false
			b.WriteRune(r)
			continue
		}
		space = true
	}
	return strings.TrimSpace(b.String())
}

func foldVietnameseRune(r rune) rune {
	switch r {
	case 'à', 'á', 'ạ', 'ả', 'ã', 'â', 'ầ', 'ấ', 'ậ', 'ẩ', 'ẫ', 'ă', 'ằ', 'ắ', 'ặ', 'ẳ', 'ẵ':
		return 'a'
	case 'è', 'é', 'ẹ', 'ẻ', 'ẽ', 'ê', 'ề', 'ế', 'ệ', 'ể', 'ễ':
		return 'e'
	case 'ì', 'í', 'ị', 'ỉ', 'ĩ':
		return 'i'
	case 'ò', 'ó', 'ọ', 'ỏ', 'õ', 'ô', 'ồ', 'ố', 'ộ', 'ổ', 'ỗ', 'ơ', 'ờ', 'ớ', 'ợ', 'ở', 'ỡ':
		return 'o'
	case 'ù', 'ú', 'ụ', 'ủ', 'ũ', 'ư', 'ừ', 'ứ', 'ự', 'ử', 'ữ':
		return 'u'
	case 'ỳ', 'ý', 'ỵ', 'ỷ', 'ỹ':
		return 'y'
	case 'đ':
		return 'd'
	default:
		return r
	}
}
