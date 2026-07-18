package service

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/dtonair/money-bot/domain"
)

func successText(tx domain.Transaction, usedAI bool) string {
	kind := "chi tiêu"
	if tx.Type == domain.TransactionIncome {
		kind = "thu nhập"
	}
	aiNote := ""
	if usedAI {
		aiNote = " (AI đã hỗ trợ hiểu tin nhắn)"
	}
	return fmt.Sprintf("✅ Đã lưu %s: %s - %s ₫.%s", kind, boundText(tx.Content(), 300), formatDong(tx.Amount), aiNote)
}

func duplicateText(tx domain.Transaction) string {
	return fmt.Sprintf("ℹ️ Giao dịch này đã được ghi trước đó: %s - %s ₫.", boundText(tx.Content(), 300), formatDong(tx.Amount))
}

func usageText() string {
	return strings.Join([]string{
		"🤷 Mình chưa hiểu giao dịch này.",
		"Vui lòng nhập dạng: ăn tối 150k pizza",
		"Thu nhập: thu lương 20tr tháng 7",
		"Báo cáo: /summary hoặc 'chi tiêu tháng này'",
	}, "\n")
}

func summaryUsageText() string {
	return strings.Join([]string{
		"🤷 Mình chưa hiểu tháng cần báo cáo.",
		"Ví dụ: /summary, /summary tháng 5, /summary 05/2026, /summary tháng trước.",
	}, "\n")
}

func formatSummary(summary domain.MonthlySummary) string {
	monthName := vietnameseMonthName(summary.Month)
	lines := []string{fmt.Sprintf("📊 Báo cáo %s %d:", monthName, summary.Year), ""}
	if summary.EntryCount == 0 {
		lines = append(lines, "📭 Chưa có dữ liệu cho tháng này.")
		return strings.Join(lines, "\n")
	}
	lines = append(lines,
		"💸 Tổng chi tiêu: "+formatDong(summary.TotalExpenses)+" ₫",
		"💰 Tổng thu nhập: "+formatDong(summary.TotalIncome)+" ₫",
		"⚖️ Cân bằng: "+formatDong(summary.Balance)+" ₫",
		"📝 Số giao dịch: "+strconv.Itoa(summary.EntryCount),
	)
	return strings.Join(lines, "\n")
}

func vietnameseMonthName(month time.Month) string {
	months := []string{"", "tháng một", "tháng hai", "tháng ba", "tháng tư", "tháng năm", "tháng sáu", "tháng bảy", "tháng tám", "tháng chín", "tháng mười", "tháng mười một", "tháng mười hai"}
	if month < time.January || month > time.December {
		return "tháng ?"
	}
	return months[int(month)]
}

func formatDong(amount int64) string {
	negative := amount < 0
	if negative {
		amount = -amount
	}
	s := strconv.FormatInt(amount, 10)
	parts := make([]string, 0, len(s)/3+1)
	for len(s) > 3 {
		parts = append([]string{s[len(s)-3:]}, parts...)
		s = s[:len(s)-3]
	}
	parts = append([]string{s}, parts...)
	out := strings.Join(parts, ".")
	if negative {
		return "-" + out
	}
	return out
}

func boundText(text string, max int) string {
	text = strings.TrimSpace(strings.Join(strings.Fields(text), " "))
	if max <= 0 {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return string(runes[:max-1]) + "…"
}
