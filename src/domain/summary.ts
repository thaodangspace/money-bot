export interface MonthlySummary {
  year: number;
  month: number;
  totalExpenses: number;
  totalIncome: number;
  balance: number;
  entryCount: number;
}

export function newMonthlySummary(
  year: number,
  month: number,
  expenses: number,
  income: number,
  count: number,
): MonthlySummary {
  return {
    year,
    month,
    totalExpenses: expenses,
    totalIncome: income,
    balance: income - expenses,
    entryCount: count,
  };
}
