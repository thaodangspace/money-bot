# money-bot Architecture Notes

`money-bot` is a Deno 2.x TypeScript Telegram bot that records Vietnamese personal-finance transactions to Google Sheets.

## Common Commands

```bash
deno task fmt:check
deno task lint
deno task check
deno task test
deno run --allow-read=testdata --allow-env src/main.ts --config ./testdata/config.example.yaml --dry-run
```

Production tasks are least-privilege and are defined in `deno.json`. Do not use `--allow-all`.

## Project Layout

- `src/main.ts`: CLI entrypoint, configuration, dependency composition, signals, and polling startup.
- `src/config`: strict YAML-compatible configuration loading, defaults, durations, environment resolution, and credential-source selection.
- `src/domain`: transport-neutral transaction, date, and monthly-summary types.
- `src/parser`: deterministic Vietnamese amount, transaction, intent, and summary-period parsing.
- `src/service`: business orchestration, Vietnamese formatting, and bounded image confirmation state.
- `src/adapters/ai`: OpenAI-compatible text/vision client and strict response validation.
- `src/adapters/google_sheets`: service-account JWT auth, Sheets REST client, idempotent repository, flat writes, and legacy reads.
- `src/adapters/telegram`: Bot API client, polling, handlers, authorization, Markdown fallback, chunking, and image acquisition.

## Spreadsheet Invariants

- New transactions are written to `YYYY-MM` worksheets.
- New worksheets are headerless and flat: `DD/MM/YYYY | income|expense | content | amount`.
- No blank rows, date-group rows, or visible headers are written to new monthly worksheets.
- `_money_bot_meta` is bot-owned and hidden. It stores schema version, Telegram update ID, processed timestamp, target sheet, and outcome.
- Transaction rows and the metadata row are appended in one batch update for idempotency/crash consistency.
- Legacy numeric sheets `1` through `12` are read-only compatibility inputs.
- `/summary` combines current `YYYY-MM` flat rows and legacy rows under matching date headers and reports totals/count/balance only.

## Security and Operational Decisions

- Single-user only: the configured Telegram user ID must match both Telegram user ID and private chat ID.
- Unauthorized updates must return before parser, AI, or Google calls.
- Run only one bot instance per spreadsheet; multiple instances can race read-before-write idempotency checks.
- Never log Telegram tokens, Google private keys, credential JSON, OpenRouter API keys, Authorization headers, or full credential contents.
- AI is required for free-text parsing. Text uses `ai.model`; images use `ai.imageModel` and require vision support.
- Images are accepted only from the authorized private user, are byte-limited and verified as JPEG/PNG/WebP, held in memory only, and explicitly confirmed before a Sheets write.
- Image previews are process-local, expire after ten minutes, cap at sixteen, and use opaque callback tokens. Writes use the original image update ID.
- Never log or persist image bytes, Telegram file URLs/IDs, captions, raw model payloads, or bank details.

## Testing Notes

Keep core behavior behind interfaces/fakes. Default tests must not require live Telegram, Google, OpenRouter, or LM Studio credentials. Add tests when changing parsing, multimodal requests, pending-image state, row schema, metadata/idempotency, legacy summaries, authorization/routing, or polling.

Google live integration is intentionally opt-in and must use a dedicated test spreadsheet and explicit write confirmation.
