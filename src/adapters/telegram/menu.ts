import type { InlineKeyboard } from './types.ts';

export const CALLBACK_REPORT = 'cmd:report';
/** Accepted only for inline keyboards rendered before the command rename. */
export const CALLBACK_LEGACY_SUMMARY = 'cmd:summary';
export const CALLBACK_HELP = 'cmd:help';
export const CALLBACK_MENU = 'cmd:menu';

export function startText(): string {
  return 'Xin chào! Mình là money-bot 💸\n\nGửi giao dịch như:\năn tối 150k pizza\nthu lương 20tr tháng 7\n/invest crypto 5tr BTC\n/saving bank 10tr Vietcombank\n\nBạn cũng có thể gửi một ảnh JPEG/PNG/WebP của hóa đơn hoặc chuyển khoản, rồi xác nhận trước khi lưu.\n\nDùng /report để xem báo cáo tháng này, hoặc /report tháng 5.';
}

export function helpText(): string {
  return 'Lệnh hỗ trợ:\n/start - bắt đầu\n/menu - menu nhanh\n/report - báo cáo tháng này\n/report tháng 5 - báo cáo tháng 5 năm hiện tại\n/report 05/2026 - báo cáo tháng 05/2026\n/report tháng trước - báo cáo tháng trước\n/invest <item> <số tiền> [ghi chú] - ghi khoản đầu tư\n/saving <item> <số tiền> [ghi chú] - ghi khoản tiết kiệm\n/help - trợ giúp\n\nCú pháp giao dịch:\năn tối 150k pizza\nthu lương 20tr tháng 7\n/invest crypto 5tr BTC\n/saving bank 10tr Vietcombank\n\nSố tiền hỗ trợ: 150k, 1,5tr, 2k5, 144tr300.\n\nẢnh: gửi một JPEG/PNG/WebP rõ nét (tối đa 5 MiB mặc định). Bot chỉ chuẩn bị giao dịch có tổng/chuyển khoản rõ ràng; bấm Xác nhận để lưu. Preview hết hạn sau 10 phút hoặc khi bot khởi động lại.';
}

export function investUsageText(): string {
  return 'Cú pháp: /invest <item> <số tiền> [ghi chú]\nVí dụ: /invest crypto 5tr BTC';
}

export function savingUsageText(): string {
  return 'Cú pháp: /saving <item> <số tiền> [ghi chú]\nVí dụ: /saving bank 10tr Vietcombank';
}

export function summaryMigrationText(): string {
  return 'Lệnh /summary đã được thay bằng /report. Ví dụ: /report tháng này';
}

export function quickMenuText(): string {
  return 'Chọn thao tác:';
}
export function quickMenuKeyboard(): InlineKeyboard {
  return [[{ text: 'Báo cáo tháng', data: CALLBACK_REPORT }], [{
    text: 'Trợ giúp',
    data: CALLBACK_HELP,
  }]];
}
export function startKeyboard(): InlineKeyboard {
  return [[{ text: 'Menu', data: CALLBACK_MENU }, { text: 'Báo cáo', data: CALLBACK_REPORT }], [{
    text: 'Trợ giúp',
    data: CALLBACK_HELP,
  }]];
}
