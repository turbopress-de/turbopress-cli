# Changelog

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
