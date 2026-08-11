import type { ReportResult } from '../../service/types.ts';

export function renderReportMarkdown(report: ReportResult): string {
  const period = `${report.year}-${String(report.month).padStart(2, '0')}`;
  const lines = [
    `# Money report — ${period}`,
    '',
    `- Total expenses: ${report.summary.totalExpenses} VND`,
    `- Total income: ${report.summary.totalIncome} VND`,
    `- Balance: ${report.summary.balance} VND`,
    `- Transactions: ${report.summary.entryCount}`,
    '',
  ];
  if (report.rows.length === 0) lines.push('No transactions.', '');
  lines.push(
    '| # | Date | Type | Content | Amount (VND) |',
    '|---:|---|---|---|---:|',
  );
  report.rows.forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ${cell(row.date)} | ${cell(row.type)} | ${
        cell(row.content)
      } | ${row.amount} |`,
    );
  });
  return `${lines.join('\n')}\n`;
}

function cell(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ').replaceAll('\\', '\\\\').replaceAll('|', '\\|');
}
