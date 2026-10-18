# Changelog

## 0.2.0

Published 2026-10-18.

- Safe retries of write requests (POST/PUT): only for HTTP 429 `rate_limited`/`queue_full` and HTTP 503 `api_draining`, where the server guarantees that nothing was created. Up to 3 retries (4 requests in total) with the same `Idempotency-Key` and body, waiting for `Retry-After` (default 60 s for 429, 120 s for 503, capped at 300 s, within the `--timeout` deadline). A `Waiting ...` line is printed to stderr before each wait; stdout is unchanged.
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
