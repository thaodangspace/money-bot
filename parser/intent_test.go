package parser

import "testing"

func TestDetectMonthlySummaryIntent(t *testing.T) {
	positives := []string{
		"chi tiêu tháng này",
		"chi tieu thang nay",
		"Tổng chi tháng này đi",
		"xem chi thang nay",
		"thống kê tháng này",
		"bao cao thang nay",
		"báo cáo chi tiêu",
		"chi tiêu tháng 5",
		"tong chi thang 05/2026",
		"/summary",
		"/summary please",
	}
	for _, input := range positives {
		if !DetectMonthlySummaryIntent(input) {
			t.Fatalf("DetectMonthlySummaryIntent(%q) = false", input)
		}
	}
}

func TestDetectMonthlySummaryIntentDoesNotMatchTransactions(t *testing.T) {
	negatives := []string{
		"ăn tối 150k pizza",
		"thu lương 20tr",
		"bao gạo 100k tháng này",
		"summary 150k",
		"",
	}
	for _, input := range negatives {
		if DetectMonthlySummaryIntent(input) {
			t.Fatalf("DetectMonthlySummaryIntent(%q) = true", input)
		}
	}
}
