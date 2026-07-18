package domain

import "time"

type MonthlySummary struct {
	Year          int
	Month         time.Month
	TotalExpenses int64
	TotalIncome   int64
	Balance       int64
	EntryCount    int
}

func NewMonthlySummary(year int, month time.Month, expenses, income int64, count int) MonthlySummary {
	return MonthlySummary{
		Year:          year,
		Month:         month,
		TotalExpenses: expenses,
		TotalIncome:   income,
		Balance:       income - expenses,
		EntryCount:    count,
	}
}
