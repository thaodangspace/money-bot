package telegram

const (
	callbackSummary = "cmd:summary"
	callbackHelp    = "cmd:help"
	callbackMenu    = "cmd:menu"
)

func startText() string {
	return "Xin chào! Mình là money-bot 💸\n\nGửi giao dịch như:\năn tối 150k pizza\nthu lương 20tr tháng 7\n\nDùng /summary để xem báo cáo tháng này, hoặc /summary tháng 5."
}

func helpText() string {
	return "Lệnh hỗ trợ:\n/start - bắt đầu\n/menu - menu nhanh\n/summary - báo cáo tháng này\n/summary tháng 5 - báo cáo tháng 5 năm hiện tại\n/summary 05/2026 - báo cáo tháng 05/2026\n/summary tháng trước - báo cáo tháng trước\n/help - trợ giúp\n\nCú pháp giao dịch:\năn tối 150k pizza\nthu lương 20tr tháng 7\n\nSố tiền hỗ trợ: 150k, 1,5tr, 2k5, 144tr300."
}

func quickMenuText() string { return "Chọn thao tác:" }

func quickMenuKeyboard() InlineKeyboard {
	return InlineKeyboard{
		{{Text: "Báo cáo tháng", Data: callbackSummary}},
		{{Text: "Trợ giúp", Data: callbackHelp}},
	}
}

func startKeyboard() InlineKeyboard {
	return InlineKeyboard{
		{{Text: "Menu", Data: callbackMenu}, {Text: "Báo cáo", Data: callbackSummary}},
		{{Text: "Trợ giúp", Data: callbackHelp}},
	}
}
