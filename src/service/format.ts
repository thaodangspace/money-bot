import type { MonthlySummary } from '../domain/summary.ts';
import { type Transaction, TRANSACTION_INCOME, transactionContent } from '../domain/transaction.ts';

export function successText(transaction: Transaction, usedAI: boolean): string {
  const kind = transaction.type === TRANSACTION_INCOME ? 'thu nhập' : 'chi tiêu';
  const aiNote = usedAI ? ' (AI đã hỗ trợ hiểu tin nhắn)' : '';
  return `✅ Đã lưu ${kind}: ${boundText(transactionContent(transaction), 300)} - ${
    formatDong(transaction.amount)
  } ₫.${aiNote}`;
}

export function duplicateText(transaction: Transaction): string {
  return `ℹ️ Giao dịch này đã được ghi trước đó: ${
    boundText(transactionContent(transaction), 300)
  } - ${formatDong(transaction.amount)} ₫.`;
}

export function imagePreviewText(transaction: Transaction): string {
  return imagePreviewTextBatch([transaction]);
}

export function imagePreviewTextBatch(transactions: Transaction[]): string {
  if (transactions.length === 1) {
    const transaction = transactions[0]!;
    const kind = transaction.type === TRANSACTION_INCOME ? 'thu nhập' : 'chi tiêu';
    return `🖼️ Mình đọc được ${kind}: ${boundText(transactionContent(transaction), 300)} - ${
      formatDong(transaction.amount)
    } ₫.\nVui lòng kiểm tra trước khi lưu.`;
  }
  const lines = [`🖼️ Tìm thấy ${transactions.length} giao dịch:`, ''];
  let income = 0;
  let expense = 0;
  transactions.forEach((transaction, index) => {
    const kind = transaction.type === TRANSACTION_INCOME ? 'Thu nhập' : 'Chi tiêu';
    if (transaction.type === TRANSACTION_INCOME) income += transaction.amount;
    else expense += transaction.amount;
    lines.push(
      `${index + 1}. ${displayDate(transaction.date)} · ${kind} · ${
        boundText(transactionContent(transaction), 220)
      } — ${formatDong(transaction.amount)} ₫`,
    );
  });
  lines.push(
    '',
    `Tổng thu nhập: ${formatDong(income)} ₫`,
    `Tổng chi tiêu: ${formatDong(expense)} ₫`,
    '⚠️ Bấm xác nhận để lưu tất cả giao dịch trong danh sách.',
  );
  return lines.join('\n');
}

export function successBatchText(transactions: Transaction[]): string {
  return transactions.length === 1
    ? successText(transactions[0]!, false)
    : `✅ Đã lưu ${transactions.length} giao dịch vào Google Sheet.`;
}

export function duplicateBatchText(transactions: Transaction[]): string {
  return transactions.length === 1
    ? duplicateText(transactions[0]!)
    : `ℹ️ ${transactions.length} giao dịch này đã được ghi trước đó.`;
}

function displayDate(date: string | undefined): string {
  if (!date) return '??/??/????';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export function imageConfirmationUnavailableText(): string {
  return '⌛ Xác nhận ảnh không còn hiệu lực. Vui lòng gửi lại ảnh.';
}

export function usageText(): string {
  return [
    '🤷 Mình chưa hiểu giao dịch này.',
    'Vui lòng nhập dạng: ăn tối 150k pizza',
    'Thu nhập: thu lương 20tr tháng 7',
    "Báo cáo: /summary hoặc 'chi tiêu tháng này'",
  ].join('\n');
}

export function summaryUsageText(): string {
  return [
    '🤷 Mình chưa hiểu tháng cần báo cáo.',
    'Ví dụ: /summary, /summary tháng 5, /summary 05/2026, /summary tháng trước.',
  ].join('\n');
}

export function formatSummary(summary: MonthlySummary): string {
  const lines = [`📊 Báo cáo ${vietnameseMonthName(summary.month)} ${summary.year}:`, ''];
  if (summary.entryCount === 0) {
    lines.push('📭 Chưa có dữ liệu cho tháng này.');
    return lines.join('\n');
  }
  lines.push(
    `💸 Tổng chi tiêu: ${formatDong(summary.totalExpenses)} ₫`,
    `💰 Tổng thu nhập: ${formatDong(summary.totalIncome)} ₫`,
    `⚖️ Cân bằng: ${formatDong(summary.balance)} ₫`,
    `📝 Số giao dịch: ${summary.entryCount}`,
  );
  return lines.join('\n');
}

export function vietnameseMonthName(month: number): string {
  const months = [
    '',
    'tháng một',
    'tháng hai',
    'tháng ba',
    'tháng tư',
    'tháng năm',
    'tháng sáu',
    'tháng bảy',
    'tháng tám',
    'tháng chín',
    'tháng mười',
    'tháng mười một',
    'tháng mười hai',
  ];
  return month >= 1 && month <= 12 ? months[month]! : 'tháng ?';
}

export function formatDong(amount: number): string {
  const negative = amount < 0;
  const digits = Math.abs(amount).toLocaleString('en-US', { useGrouping: false });
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return negative ? `-${grouped}` : grouped;
}

export function boundText(text: string, max: number): string {
  const normalized = text.trim().split(/\s+/u).filter(Boolean).join(' ');
  if (max <= 0) return '';
  const characters = Array.from(normalized);
  return characters.length <= max ? normalized : `${characters.slice(0, max - 1).join('')}…`;
}
