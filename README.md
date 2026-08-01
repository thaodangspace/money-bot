# money-bot

`money-bot` is a private Deno 2.x/TypeScript Telegram bot for recording Vietnamese personal-finance transactions into Google Sheets.

The service uses the existing spreadsheet schema and remains compatible with legacy monthly sheets; no spreadsheet data migration is required.

## Features

- Deno 2.x TypeScript Telegram long-polling bot.
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
- JPEG, PNG, or WebP receipt and completed bank-transfer image capture, with explicit confirmation before a Sheets write.

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
# Configure ai.imageModel with a vision-capable model to capture transactions from images.
# Or configure ai.provider: openrouter and export OPENROUTER_API_KEY.

deno run --allow-read=config.yaml --allow-env src/main.ts --config ./config.yaml --dry-run
deno task start:openrouter
```

### Deno Deploy

Deno Deploy can run without `config.yaml`. Set the variables from `.env.example` in the Deploy dashboard and use `src/main.ts` as the entrypoint. When `./config.yaml` is absent, the bot automatically builds its configuration from environment variables. Use OpenRouter or another publicly reachable AI endpoint; LM Studio on `localhost` is not available on Deploy.

## Telegram commands

- `/start` - intro and quick actions
- `/menu` - inline menu
- `/summary` - current-month report
- `/summary tháng 5`, `/summary 05/2026`, `/summary tháng trước` - report another month
- `/help` - syntax help

Ordinary text is sent to the configured LLM and treated as a transaction unless it is a command or a summary intent such as `chi tiêu tháng này`.

## Image transactions

Send one standalone JPEG, PNG, or WebP photo/document (up to `telegram.maxImageBytes`, 5 MiB by default), optionally with a short caption. The configured `ai.imageModel` (or `ai.model` when omitted) must support vision input.

The bot extracts one clearly displayed final paid/transferred VND amount from a receipt or transfer, or every clearly completed transaction from a standalone transaction-list image (up to 20). Receipt line items are never separate transactions. It shows a preview and requires **Xác nhận** to write all listed entries, or **Hủy** to discard them. Partial/ambiguous lists, ambiguous/internal/pending transfers, albums, unsupported formats, and unclear images are rejected without a write. Pending previews expire after 10 minutes, are lost on bot restart, and must be resent if unavailable.

Images, raw OCR/model output, and captions are not stored. LM Studio can keep vision inference local; OpenRouter sends the image to its remote provider, so use it only when that privacy boundary is acceptable.

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
- Logs avoid secret values and full credential contents; they also exclude image bytes, file URLs, OCR text, captions, and model payloads.
- Image confirmation is process-local and uses the original image update ID for Sheets idempotency.

## Verification

The default test suite uses fakes and local HTTP servers; it does not require live Telegram, Google, OpenRouter, or LM Studio credentials.

```bash
deno task fmt:check
deno task lint
deno task check
deno task test

```

Live Google Sheets integration should be run only against a dedicated test spreadsheet and is not part of the default test suite.

## Troubleshooting

- **No writes to Sheets**: verify the service account has editor access to the spreadsheet.
- **Duplicate message not added**: expected behavior when Telegram redelivers the same update ID.
- **Legacy data missing from summary**: old rows must be under a valid `DD/MM/YYYY` date header for the requested month/year.
- **AI parsing unavailable**: ensure LM Studio is running with a model loaded at `ai.baseURL`, or set `ai.provider: openrouter` and export the configured API key.
- **Image parsing unavailable**: configure `ai.imageModel` (or `ai.model`) with a vision-capable model. For unclear receipts/transfers, send one complete, clearer image and confirm the preview before it is saved.
