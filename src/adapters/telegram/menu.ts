import type { InlineKeyboard } from './types.ts';

export const CALLBACK_SUMMARY = 'cmd:summary';
export const CALLBACK_HELP = 'cmd:help';
export const CALLBACK_MENU = 'cmd:menu';

export function startText(): string {
  return 'Xin chào! Mình là money-bot 💸\n\nGửi giao dịch như:\năn tối 150k pizza\nthu lương 20tr tháng 7\n\nBạn cũng có thể gửi một ảnh JPEG/PNG/WebP của hóa đơn hoặc chuyển khoản, rồi xác nhận trước khi lưu.\n\nDùng /summary để xem báo cáo tháng này, hoặc /summary tháng 5.';
}

export function helpText(): string {
  return 'Lệnh hỗ trợ:\n/start - bắt đầu\n/menu - menu nhanh\n/summary - báo cáo tháng này\n/summary tháng 5 - báo cáo tháng 5 năm hiện tại\n/summary 05/2026 - báo cáo tháng 05/2026\n/summary tháng trước - báo cáo tháng trước\n/help - trợ giúp\n\nCú pháp giao dịch:\năn tối 150k pizza\nthu lương 20tr tháng 7\n\nSố tiền hỗ trợ: 150k, 1,5tr, 2k5, 144tr300.\n\nẢnh: gửi một JPEG/PNG/WebP rõ nét (tối đa 5 MiB mặc định). Bot chỉ chuẩn bị giao dịch có tổng/chuyển khoản rõ ràng; bấm Xác nhận để lưu. Preview hết hạn sau 10 phút hoặc khi bot khởi động lại.';
}

export function quickMenuText(): string {
  return 'Chọn thao tác:';
}
export function quickMenuKeyboard(): InlineKeyboard {
  return [[{ text: 'Báo cáo tháng', data: CALLBACK_SUMMARY }], [{
    text: 'Trợ giúp',
    data: CALLBACK_HELP,
  }]];
}
export function startKeyboard(): InlineKeyboard {
  return [[{ text: 'Menu', data: CALLBACK_MENU }, { text: 'Báo cáo', data: CALLBACK_SUMMARY }], [{
    text: 'Trợ giúp',
    data: CALLBACK_HELP,
  }]];
}
