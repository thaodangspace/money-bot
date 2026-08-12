export interface MonthlySummary {
  year: number;
  month: number;
  totalExpenses: number;
  totalIncome: number;
  totalInvest: number;
  totalSaving: number;
  balance: number;
  entryCount: number;
}

export function newMonthlySummary(
  year: number,
  month: number,
  expenses: number,
  income: number,
  count: number,
  invest = 0,
  saving = 0,
): MonthlySummary {
  return {
    year,
    month,
    totalExpenses: expenses,
    totalIncome: income,
    totalInvest: invest,
    totalSaving: saving,
    balance: income - expenses - invest - saving,
    entryCount: count,
  };
}
