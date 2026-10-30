# Changelog

## 0.6.0

- New agency commands for the Hosting API (synchronous, no `--wait`; every write sends an `Idempotency-Key`, also `PATCH`/`PUT`):
  - `turbopress clients list|show|create|update|delete` (`delete` needs `--confirm` with the exact client name; it also removes work log, reports and share links).
  - `turbopress sites list --client ID|none` and `turbopress sites set-client SITE_ID CLIENT_ID|none`.
  - `turbopress plugins list [--state ...] [--premium]`, `plugins show SLUG`, `plugins site SITE_ID` (`plugins enable|disable` unchanged).
  - `turbopress licenses list` and `licenses set SLUG --paid-by agency|client [--kind] [--expires YYYY-MM-DD|none]`.
  - `turbopress work list CLIENT_ID [--month YYYY-MM]`, `work add` (`--date`, `--minutes`, `--text`, `--site`, `--external-id`) and `work rm CLIENT_ID ENTRY_ID`.
  - `turbopress reports list|show|share|send` (`send --resend` sends an already sent report again).
  - `turbopress webhooks list|show|create|update|delete|test|deliveries|rotate-secret`.
- Secrets are shown once: the share URL of `reports share` and the secret of `webhooks create` and `rotate-secret` go to stdout only, with a warning on stderr; they are never written to errors or diagnostics.
- `turbopress token` shows the new `scope` field (`sites`, `client`, `account`).
- The client sends `PATCH` and handles `204 No Content`.
- Error codes of the new routes carry a hint (for example `feature_not_enabled`, `feature_unavailable`, `secret_not_replayable`, `confirmation_mismatch` for client names, `too_many_links`, `resend_limit`, `already_sent`, `name_taken`, `duplicate_entry`, `invalid_webhook_url`, `webhook_limit`, `webhook_inactive`).
- Test fixture `tests/fixtures/openapi.json` updated to the current API contract (50 operations).

## 0.5.0

- New `turbopress backups restore --site SITE --backup ID --scope full|database|files|folder [--folder ...] --confirm-host HOST [--confirm-data-loss]`: restores a backup over the site (overwrites the site, safety backup first, no automatic rollback). Scope and host confirmation are mandatory; nothing is defaulted.
- New `turbopress core update --site SITE [--expected-version X]`: updates WordPress core after a safety backup.
- New `turbopress plugins enable|disable --site SITE --plugin SLUG`: switches one installed plugin.
- New `turbopress staging create --site LIVE_SITE`: creates the staging copy of a live site.
- New `turbopress staging push --site LIVE_SITE --scope all|files|db|selected [--tables a,b] --delete-missing-files|--no-delete-missing-files --confirm-host LIVE_HOST [--confirm-data-loss]`: overwrites the live site with its staging copy. The delete flag and the live host are mandatory and never defaulted or derived. `--dry-run` checks without changing anything: answered at once, no job and no Idempotency-Key; the result is printed as readable text (`--json` for the raw data).
- All new job commands support `--wait`, `--timeout` and `--idempotency-key`, with the same exit codes (`failed` 1, `unknown` 4) and the same safe retries (HTTP 429 `rate_limited`/`queue_full`, HTTP 503 `api_draining`, same Idempotency-Key). The result of a failed or unknown job is printed to stdout. A finished restore or push with `health_check` `issue_found` exits 0 and warns on stderr.
- API and operation error codes of the new commands are printed with a short hint (for example `staging_exists`, `storage_insufficient`, `no_core_update`, `version_changed`, `network_activated`, `plugin_not_installed`, `delegation_unavailable`, `service_unavailable`, `staging_ambiguous`, `woo_confirmation_missing`, `copy_outcome_unknown`). The `account_not_enabled` and `job_expired` messages now carry the same kind of hint.
- Test fixture `tests/fixtures/openapi.json` updated to the current API contract (24 operations).

## 0.4.0

Published 2026-10-18.

- New `turbopress updates list --site SITE`: open plugin, theme and core updates of a WordPress site (synchronous, can take up to about 100 s; the CLI allows 110 s for this request).
- New `turbopress updates run --site SITE --plugin SLUG... --theme SLUG... [--wait]`: updates 1 to 5 plugins and themes (no core update); creates a safety backup first. With `--wait` the exit code is 1 if the job failed or an item failed or was skipped, and 4 if the outcome is unknown or an item is unconfirmed.
- New `turbopress staging delete --site LIVE_SITE --confirm STAGING_HOST [--wait]`: removes the staging site permanently. `--confirm` is required and is never derived.
- `sites list` and `sites show` now include `role` and `staging_of` as returned by the API.
- A failed or unknown `updates run`/`staging delete` job with `--wait` prints its result to stdout before exiting.
- Same safe retries as other mutations (HTTP 429 `rate_limited`/`queue_full`, HTTP 503 `api_draining`).

## 0.3.0

Published 2026-10-18.

- New `turbopress operations list [--site SITE] [--status STATUS] [--limit 1..100] [--cursor CURSOR]`: lists the operations created by the calling token.
- New `turbopress token`: shows metadata of the calling token (id, name, permissions, targets, creation, expiry, last use).
- New `turbopress status`: shows the API state (`ok` or `draining`). Needs no token and sends none; exit code 0 in both cases.
- New `turbopress backups delete --site SITE --backup ID [--wait]`: removes a backup permanently (job; supports `--wait`, `--timeout` and `--idempotency-key`).
- DELETE requests require an `Idempotency-Key` and use the same safe retries as POST/PUT (HTTP 429 `rate_limited`/`queue_full`, HTTP 503 `api_draining`).
- All other commands still require `TURBOPRESS_API_TOKEN` (exit 3).

## 0.2.0

Published 2026-10-18.

- Safe retries of write requests (POST/PUT): only for HTTP 429 `rate_limited`/`queue_full` and HTTP 503 `api_draining`, where the server guarantees that nothing was created. Up to 3 retries (4 requests in total) with the same `Idempotency-Key` and body, waiting for `Retry-After` (default 60 s for 429, 120 s for 503, capped at 300 s per wait; with `--wait` all waits count against the `--timeout` deadline; without `--wait` the total retry wait is capped at 600 s). A `Waiting ...` line is printed to stderr before each wait; stdout is unchanged.
- All other responses (for example `daily_limit`, other 503 or 5xx, network errors, timeouts) are still not retried. Exit codes are unchanged.

## 0.1.1

Published 2026-10-18.

- Package page and README now write the brand in lowercase (`turbopress`); no functional changes.

## 0.1.0

Published 2026-10-18.

First public release on npm as `@turbopress-de/cli`. The Hosting API is currently restricted to an approved pilot account.

- `sites list|show`
- `backups list|create`
- `cache purge --scope page|object|all`
- `operations get|wait`
- `deployments create|put-file|preview|publish|list|rollback`
- `--wait`/`--timeout` for long-running operations, automatic `Idempotency-Key` for mutations
- Exit codes 0 (success), 1 (API/network/failed operation), 2 (usage), 3 (auth/permission), 4 (timeout/unknown outcome)
- Error messages include the API error code and request ID (e.g. `HTTP 403, account_not_enabled`); failed or unknown operations include the job `error_code` (e.g. `job_expired`, `blocking`)
- Token only via `TURBOPRESS_API_TOKEN`; no endpoint override; redirects refused
