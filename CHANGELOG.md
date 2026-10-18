# Changelog

## 0.4.0

Published 2026-10-18.

- New `turbopress updates list --site SITE`: open plugin, theme and core updates of a WordPress site (synchronous, can take up to about 100 s; the CLI allows 110 s for this request).
- New `turbopress updates run --site SITE --plugin SLUG... --theme SLUG... [--wait]`: updates 1 to 5 plugins and themes (no core update); creates a safety backup first. With `--wait` the exit code is 1 if the job failed or an item was not updated.
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
