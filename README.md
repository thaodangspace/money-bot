# money-bot

`money-bot` is a private Go Telegram bot for recording Vietnamese personal-finance transactions into Google Sheets.

It is the Go/Telegram migration of the Deno/Slack `tiubot` behavior, with a flatter new spreadsheet schema and compatibility reads for old monthly sheets.

## Features

- Go 1.24 Telegram long-polling bot.
- Single authorized private Telegram user.
- Vietnamese transaction parsing:
  - `ăn tối 150k pizza`
  - `thu lương 20tr tháng 7`
  - `cà phê 2k5`
  - `bán xe 144tr300 cũ`
- Google Sheets storage.
- New monthly worksheets named `YYYY-MM`.
- New row format, no header/group rows. Content keeps the original message and prefixes the detected category in parentheses:
  - `18/07/2026 | expense | (food) ăn tối 150k pizza | 150000`
  - `18/07/2026 | income | (salary) thu lương 20tr tháng 7 | 20000000`
- Legacy read compatibility for old numeric sheets `1` through `12` in Tiubot format.
- Hidden `_money_bot_meta` worksheet for Telegram update idempotency.
- `/summary` current-month totals across new and legacy sheets, with optional month arguments for older months.
- Required LLM parsing for free-text transactions, with local LM Studio/OpenAI-compatible endpoint support and OpenRouter support.

## Quick start

```bash
cp config.example.yaml config.yaml
cp .env.example .env
# Edit config.yaml and export env vars, or source .env carefully.
export TELEGRAM_BOT_TOKEN='123456:your-token'
export GOOGLE_SHEET_ID='your-sheet-id'
export GOOGLE_SERVICE_ACCOUNT_EMAIL='money-bot@project.iam.gserviceaccount.com'
export GOOGLE_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n'
# Default AI config expects LM Studio running locally with a loaded model.
# Or configure ai.provider: openrouter and export OPENROUTER_API_KEY.

go run ./cmd/money-bot --config ./config.yaml --dry-run
go run ./cmd/money-bot --config ./config.yaml
```

## Telegram commands

- `/start` - intro and quick actions
- `/menu` - inline menu
- `/summary` - current-month report
- `/summary tháng 5`, `/summary 05/2026`, `/summary tháng trước` - report another month
- `/help` - syntax help

Ordinary text is sent to the configured LLM and treated as a transaction unless it is a command or a summary intent such as `chi tiêu tháng này`.

## Google Sheets setup

1. Create a Google Cloud service account.
2. Share the target spreadsheet with the service-account email as editor.
3. Configure either:
   - `google.credentialsFile`, or
   - `google.credentialsJSONEnv`, or
   - legacy env vars `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY`.
4. Configure the spreadsheet ID via `google.spreadsheetId`, `google.spreadsheetIdEnv`, or `GOOGLE_SHEET_ID`.

### New sheet format

For each transaction date, the bot writes to that month worksheet (`YYYY-MM`). There are no headers, blank spacer rows, or date group rows.

Columns:

1. Date: `DD/MM/YYYY`
2. Type: `expense` or `income`
3. Content: detected category in parentheses plus the original message
4. Amount: integer Vietnamese đồng

### Legacy sheets

Old Tiubot numeric sheets (`1` through `12`) remain unchanged. `/summary` reads legacy date-header groups and includes only rows under a matching `DD/MM/YYYY` date header for the current year/month.

No automatic migration, cleanup, or de-duplication of historical rows is performed.

## Security and operations

- Only `telegram.allowedUserId` in the matching private chat is accepted.
- Unauthorized updates do not call parser, AI, or Google APIs.
- Do not commit `config.yaml`, `.env`, or credential JSON files.
- Run one money-bot instance per spreadsheet. Multiple writers can race Google Sheets' read-before-write idempotency check.
- Logs avoid secret values and full credential contents.

## Verification

The default test suite uses fakes and local HTTP servers; it does not require live Telegram, Google, OpenRouter, or LM Studio credentials.

```bash
go test ./...
go test -race ./telegram ./sheets ./ai
go vet ./...
go build ./cmd/money-bot
go run ./cmd/money-bot --config ./testdata/config.example.yaml --dry-run
```

Optional live Sheets integration is intentionally skipped unless explicitly enabled:

```bash
MONEY_BOT_SHEETS_INTEGRATION=1 \
MONEY_BOT_TEST_SPREADSHEET_ID='test-sheet-id' \
MONEY_BOT_CONFIRM_LIVE_SHEETS_WRITE=1 \
go test ./sheets -run Integration -v
```

## Troubleshooting

- **No writes to Sheets**: verify the service account has editor access to the spreadsheet.
- **Duplicate message not added**: expected behavior when Telegram redelivers the same update ID.
- **Legacy data missing from summary**: old rows must be under a valid `DD/MM/YYYY` date header for the requested month/year.
- **AI parsing unavailable**: ensure LM Studio is running with a model loaded at `ai.baseURL`, or set `ai.provider: openrouter` and export the configured API key.
