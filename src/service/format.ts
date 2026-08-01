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
  const kind = transaction.type === TRANSACTION_INCOME ? 'thu nhập' : 'chi tiêu';
  return `🖼️ Mình đọc được ${kind}: ${boundText(transactionContent(transaction), 300)} - ${
    formatDong(transaction.amount)
  } ₫.\nVui lòng kiểm tra trước khi lưu.`;
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
