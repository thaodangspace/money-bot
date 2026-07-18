# money-bot Architecture Notes

`money-bot` is a Go Telegram bot that records Vietnamese personal-finance transactions to Google Sheets.

## Common Commands

Use local caches in sandboxed agent runs if the default Go cache is blocked:

```bash
GOTOOLCHAIN=local GOMODCACHE=$PWD/.gomodcache GOCACHE=$PWD/.gocache GOSUMDB=off go test ./...
GOTOOLCHAIN=local GOMODCACHE=$PWD/.gomodcache GOCACHE=$PWD/.gocache GOSUMDB=off go test -race ./telegram ./sheets ./ai
GOTOOLCHAIN=local GOMODCACHE=$PWD/.gomodcache GOCACHE=$PWD/.gocache GOSUMDB=off go vet ./...
GOTOOLCHAIN=local GOMODCACHE=$PWD/.gomodcache GOCACHE=$PWD/.gocache GOSUMDB=off go run ./cmd/money-bot --config ./testdata/config.example.yaml --dry-run
```

Normal developer commands outside the sandbox:

```bash
go test ./...
go vet ./...
go run ./cmd/money-bot --config ./config.yaml --dry-run
go run ./cmd/money-bot --config ./config.yaml
```

## Project Layout

- `cmd/money-bot`: CLI entrypoint, config loading, dependency composition, signal handling, Telegram polling startup.
- `config`: strict YAML/env config loading, defaults, path expansion, timezone loading, and credential-source selection.
- `authz`: single authorized private Telegram user guard.
- `domain`: transport-neutral transaction and monthly summary types.
- `parser`: deterministic Vietnamese transaction and current-month summary intent parsing.
- `sheets`: Google Sheets repository, monthly worksheet creation, flat row writes, hidden metadata/idempotency, legacy reads, and summaries.
- `ai`: optional OpenRouter client and strict AI JSON validation.
- `service`: deterministic-first business orchestration and Vietnamese response formatting.
- `telegram`: Telegram Bot API adapter, Markdown escaping/fallback, command/callback handlers, chunking, and sequential polling.

## Spreadsheet Invariants

- New transactions are written to `YYYY-MM` worksheets.
- New worksheets are headerless and flat: `DD/MM/YYYY | income|expense | content | amount`.
- No blank rows, date-group rows, or visible headers are written to new monthly worksheets.
- `_money_bot_meta` is bot-owned and hidden. It stores schema version, Telegram update ID, processed timestamp, target sheet, and outcome.
- Transaction row and metadata row are appended in the same batch update for idempotency/crash consistency.
- Legacy numeric sheets `1` through `12` are read-only compatibility inputs. Do not rewrite them automatically.
- `/summary` combines current `YYYY-MM` flat rows and legacy rows under matching date headers. It reports totals/count/balance only; no category breakdown.

## Security/Operational Decisions

- Single-user only: `telegram.allowedUserId` must match both Telegram user ID and private chat ID.
- Unauthorized updates must return before parser, AI, or Google calls.
- Run only one bot instance per spreadsheet; multiple bot instances can race Google Sheets read-before-write idempotency checks.
- Do not log Telegram tokens, Google private keys, credential JSON, OpenRouter API keys, Authorization headers, or full credential contents.
- AI is optional OpenRouter only. Deterministic parses never call AI, and AI never supplies canonical summary arithmetic.
- Timezone defaults to `Asia/Ho_Chi_Minh`; transaction date and target sheet must use the configured location.

## Testing Notes

- Keep core behavior behind fakes/interfaces; default tests must not require live Telegram, Google, or OpenRouter credentials.
- `sheets` has optional live integration scaffolding gated by `MONEY_BOT_SHEETS_INTEGRATION=1`, an explicit test spreadsheet ID, and a write confirmation flag.
- Add tests when changing parsing, row schema, metadata/idempotency, legacy summary reads, Telegram authorization/routing, or OpenRouter validation.

## Dependency Notes

- `google.golang.org/api` is pinned to a Go 1.24-compatible version. Do not upgrade to a version requiring Go 1.25 unless the project Go version is intentionally updated.
