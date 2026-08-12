import { financialRatios, type FinancialSummary } from '../domain/financial_summary.ts';
import type { MonthlySummary } from '../domain/summary.ts';
import {
  type Transaction,
  TRANSACTION_INCOME,
  TRANSACTION_INVEST,
  TRANSACTION_SAVING,
  transactionContent,
} from '../domain/transaction.ts';

export function successText(transaction: Transaction, usedAI: boolean): string {
  const kind = transactionKind(transaction.type);
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
    const kind = transactionKind(transaction.type);
    return `🖼️ Mình đọc được ${kind}: ${boundText(transactionContent(transaction), 300)} - ${
      formatDong(transaction.amount)
    } ₫.\nVui lòng kiểm tra trước khi lưu.`;
  }
  const lines = [`🖼️ Tìm thấy ${transactions.length} giao dịch:`, ''];
  let income = 0;
  let expense = 0;
  let invest = 0;
  let saving = 0;
  transactions.forEach((transaction, index) => {
    const kind = transactionKind(transaction.type, true);
    if (transaction.type === TRANSACTION_INCOME) income += transaction.amount;
    else if (transaction.type === TRANSACTION_INVEST) invest += transaction.amount;
    else if (transaction.type === TRANSACTION_SAVING) saving += transaction.amount;
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
    `Tổng đầu tư: ${formatDong(invest)} ₫`,
    `Tổng tiết kiệm: ${formatDong(saving)} ₫`,
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
    "Báo cáo: /report hoặc 'chi tiêu tháng này'",
  ].join('\n');
}

export function aiUnrecognizedText(): string {
  return [
    '🤔 Mình không nhận ra một giao dịch rõ ràng trong tin nhắn (không thấy số tiền hoặc chiều thu/chi không rõ).',
    'Thử lại với số tiền cụ thể, ví dụ: ăn tối 150k hoặc thu lương 20tr.',
  ].join('\n');
}

export function aiUnavailableText(): string {
  return '😵 Mình tạm thời không xử lý được tin nhắn (AI không khả dụng). Vui lòng thử lại sau vài phút.';
}

export function aiInvalidResponseText(): string {
  return '🤖 Mình không đọc được phản hồi từ AI để ghi giao dịch. Vui lòng thử gửi lại tin nhắn.';
}

export function reportUsageText(): string {
  return [
    '🤷 Mình chưa hiểu tháng cần báo cáo.',
    'Ví dụ: /report, /report tháng 5, /report 05/2026, /report tháng trước.',
  ].join('\n');
}

/** @deprecated Use reportUsageText. */
export const summaryUsageText = reportUsageText;

export function formatFinancialSummary(summary: FinancialSummary): string {
  const lines = ['📊 Tổng quan tài chính — toàn thời gian', ''];
  if (summary.entryCount === 0) {
    lines.push('📭 Chưa có giao dịch để tổng hợp.');
    return lines.join('\\n');
  }
  lines.push(
    `💵 Tổng thu nhập: ${formatDong(summary.totalIncome)} ₫`,
    `💸 Tổng chi tiêu: ${formatDong(summary.totalExpenses)} ₫`,
    `🏦 Tổng tiết kiệm: ${formatDong(summary.totalSaving)} ₫`,
    `📈 Tổng đầu tư: ${formatDong(summary.totalInvest)} ₫`,
    `💰 Tiền mặt khả dụng*: ${formatDong(summary.cashAvailable)} ₫`,
    '',
    `📝 ${summary.entryCount} giao dịch`,
  );
  if (summary.firstTransactionDate && summary.lastTransactionDate) {
    lines.push(`📅 Dữ liệu: ${summary.firstTransactionDate} → ${summary.lastTransactionDate}`);
  }
  const ratios = financialRatios(summary);
  if (ratios.expenseToIncome !== undefined) {
    lines.push(
      '',
      `Chi tiêu / thu nhập: ${formatRatio(ratios.expenseToIncome)}`,
      `Tiết kiệm / thu nhập: ${formatRatio(ratios.savingToIncome!)}`,
      `Đầu tư / thu nhập: ${formatRatio(ratios.investToIncome!)}`,
    );
  }
  lines.push(
    '',
    '* Theo dữ liệu đã ghi: thu nhập - chi tiêu - đầu tư - tiết kiệm. Đây không phải số dư ngân hàng.',
  );
  return lines.join('\\n');
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
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
    `📈 Tổng đầu tư: ${formatDong(summary.totalInvest)} ₫`,
    `🏦 Tổng tiết kiệm: ${formatDong(summary.totalSaving)} ₫`,
    `⚖️ Còn lại: ${formatDong(summary.balance)} ₫`,
    `📝 Số giao dịch: ${summary.entryCount}`,
  );
  return lines.join('\n');
}

function transactionKind(type: Transaction['type'], titleCase = false): string {
  const kind = type === TRANSACTION_INCOME
    ? 'thu nhập'
    : type === TRANSACTION_INVEST
    ? 'đầu tư'
    : type === TRANSACTION_SAVING
    ? 'tiết kiệm'
    : 'chi tiêu';
  return titleCase ? kind[0]!.toLocaleUpperCase('vi-VN') + kind.slice(1) : kind;
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
