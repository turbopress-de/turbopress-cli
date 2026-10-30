# turbopress CLI

Command-line client for the turbopress Hosting API (`https://panel.turbopress.de/api/v1`). Node.js 22 or newer is required. The CLI uses native `fetch`; no runtime packages or local token configuration are needed. Supported platforms: Linux, macOS and Windows.

The CLI source is public under the MIT license and release builds are published to npm as `@turbopress-de/cli` (requires Node.js >=22) with build provenance.

**Pilot status:** the Hosting API is currently restricted to an explicitly approved pilot account. Other accounts receive an authorization error (HTTP 403, `account_not_enabled`, exit code 3) until the API is activated for them. Installing works for everyone; API commands only succeed for enabled accounts.

## Install and authenticate

Install from npm:

```sh
npm install --global @turbopress-de/cli
turbopress --version
# or without a global install:
npx @turbopress-de/cli sites list --json
```

For reproducible setups pin the version, for example `@turbopress-de/cli@0.6.0`. Alternatively build from source:

```sh
git clone https://github.com/turbopress-de/turbopress-cli.git
cd turbopress-cli
npm ci
npm run build
node dist/bin.js sites list --json
```

Export a scoped API token through `TURBOPRESS_API_TOKEN`. The CLI accepts no token argument, token file, alternate endpoint or URL override. Keep the variable in your shell's secret manager or CI secret store; do not place it in scripts, command lines, logs or repository files.

```sh
export TURBOPRESS_API_TOKEN='...'
turbopress sites list --json
```

For CI, inject the token as a masked secret into the step environment. Pin the published package version and use Node.js 22 or newer. A token can be revoked independently of any SSH key used for WordPress code deployment.

## Commands

```text
turbopress sites list [--limit 1..100] [--cursor CURSOR] [--json]
turbopress sites show --site SITE [--json]
turbopress backups list --site SITE [--limit 1..100] [--cursor CURSOR] [--json]
turbopress backups delete --site SITE --backup ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress backups create --site SITE [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress cache purge --site SITE --scope page|object|all [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress operations list [--site SITE] [--status STATUS] [--limit 1..100] [--cursor CURSOR] [--json]
turbopress operations get ID [--json]
turbopress operations wait ID [--timeout SECONDS] [--json]
turbopress deployments create --site SITE [--idempotency-key KEY] [--json]
turbopress deployments put-file --site SITE --deployment ID --path RELATIVE_PATH --file LOCAL_FILE [--idempotency-key KEY] [--json]
turbopress deployments preview --site SITE --deployment ID [--idempotency-key KEY] [--json]
turbopress deployments publish --site SITE --deployment ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress deployments list --site SITE [--limit 1..100] [--cursor CURSOR] [--json]
turbopress deployments rollback --site SITE --deployment ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress updates list --site SITE [--json]
turbopress updates run --site SITE [--plugin SLUG]... [--theme SLUG]... [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress staging delete --site LIVE_SITE --confirm STAGING_HOST [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress backups restore --site SITE --backup ID --scope full|database|files|folder [--folder wp-content/...] --confirm-host SITE_HOST [--confirm-data-loss] [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress core update --site SITE [--expected-version X.Y[.Z]] [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress plugins enable|disable --site SITE --plugin SLUG [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress staging create --site LIVE_SITE [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress staging push --site LIVE_SITE --scope all|files|db|selected [--tables a,b] --delete-missing-files|--no-delete-missing-files --confirm-host LIVE_HOST [--confirm-data-loss] [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress staging push --site LIVE_SITE --scope all|files|db|selected [--tables a,b] --dry-run [--json]
turbopress clients list [--limit 1..100] [--cursor CURSOR] [--json]
turbopress clients show ID [--json]
turbopress clients create --name NAME [--contact-name N] [--email MAIL] [--note TEXT] [--maintenance-contract true|false] [--send-report true|false] [--quota-minutes N|none] [--price-month-cent N|none] [--idempotency-key KEY] [--json]
turbopress clients update ID [same fields as create] [--idempotency-key KEY] [--json]
turbopress clients delete ID --confirm "EXACT CLIENT NAME" [--idempotency-key KEY] [--json]
turbopress sites list --client ID|none [--limit 1..100] [--cursor CURSOR] [--json]
turbopress sites set-client SITE_ID CLIENT_ID|none [--idempotency-key KEY] [--json]
turbopress plugins list [--state vulnerable|update|ok|inactive] [--premium] [--limit 1..100] [--cursor CURSOR] [--json]
turbopress plugins show SLUG [--json]
turbopress plugins site SITE_ID [--json]
turbopress licenses list [--limit 1..100] [--cursor CURSOR] [--json]
turbopress licenses set SLUG --paid-by agency|client [--kind TEXT] [--expires YYYY-MM-DD|none] [--idempotency-key KEY] [--json]
turbopress work list CLIENT_ID [--month YYYY-MM] [--limit 1..100] [--cursor CURSOR] [--json]
turbopress work add CLIENT_ID --date YYYY-MM-DD --minutes 5..1440 --text TEXT [--site SITE_ID] [--external-id ID] [--idempotency-key KEY] [--json]
turbopress work rm CLIENT_ID ENTRY_ID [--idempotency-key KEY] [--json]
turbopress reports list CLIENT_ID [--json]
turbopress reports show CLIENT_ID PERIOD [--json]
turbopress reports share CLIENT_ID PERIOD [--idempotency-key KEY] [--json]
turbopress reports send CLIENT_ID PERIOD [--resend] [--idempotency-key KEY] [--json]
turbopress webhooks list [--json]
turbopress webhooks show ID [--json]
turbopress webhooks create --url https://... --events a,b [--idempotency-key KEY] [--json]
turbopress webhooks update ID [--url URL] [--events a,b] [--active true|false] [--idempotency-key KEY] [--json]
turbopress webhooks delete ID [--idempotency-key KEY] [--json]
turbopress webhooks test ID [--idempotency-key KEY] [--json]
turbopress webhooks deliveries ID [--json]
turbopress webhooks rotate-secret ID [--idempotency-key KEY] [--json]
turbopress token [--json]
turbopress status [--json]
turbopress --version
```

`backups delete` removes the backup permanently; the API refuses the newest backup of a site (`backup_protected`) and any backup while a backup is running (`backup_in_use`). `ID` is the backup `id` from `backups list` (1 to 120 characters from `A-Za-z0-9._+:-`, not starting with `-`; file names containing `..` or starting with `.` cannot be deleted via the CLI, delete them in Plesk). `operations list` shows the operations created by the calling token, `--status` is one of `queued`, `running`, `succeeded`, `failed`, `unknown`. `token` shows metadata of the calling token (never the secret). `status` reports the API state (`ok` or `draining`) and is the only command that needs no `TURBOPRESS_API_TOKEN`; it never sends one. It exits 0 for `draining` as well.

`updates list` reads the open plugin, theme and core updates of a WordPress site (permission `updates:read`). The server checks the installation live, so the call can take up to about 100 seconds; the CLI allows 110 seconds for each request attempt. Reads are retried up to twice (timeouts, network errors, HTTP 429/502/503/504), so the worst case is about 5.5 minutes, and the server may run its wp-cli scan up to three times; do not call it in a loop. `updates run` updates plugins and themes only (permission `updates:run`): give 1 to 5 items in total with `--plugin SLUG` and `--theme SLUG`, which may be repeated (slugs: lowercase letters, digits and hyphens, no duplicates). There is no core update and no "update everything". The job creates a safety backup first; with `--wait` the result (`safety_backup` and one status per item: `updated`, `unchanged`, `failed`, `skipped`, `unconfirmed`) is printed, and the exit code is 1 if the job failed or an item failed or was skipped (or has any status other than `updated`/`unchanged`), and 4 if the outcome is unknown or an item is `unconfirmed`. A diagnostic with the affected slugs, the operation ID and the idempotency key goes to stderr. The CLI cannot roll back; restore the safety backup manually.

`staging delete` removes the staging site permanently (permission `staging:delete`, irreversible). `--site` is the live site; `--confirm` is required, has no default and is never derived from the site ID: pass the exact staging host (for example `staging.example.com`, lowercase ASCII, Punycode for international names). The server refuses a mismatch with `confirmation_mismatch` and deletes nothing. `sites list` and `sites show` report `role` (`live` or `staging`) and `staging_of` as returned by the API.

**Destructive commands (new in 0.5.0).** `backups restore` and `staging push` overwrite a live site; `core update` changes WordPress itself. None of them has a default for anything that overwrites or deletes data: every such choice is a mandatory flag, and the confirmation of the host is never filled in by the CLI. All three run as jobs and create a safety backup first (it needs a free backup slot); there is no automatic rollback, the safety backup named in the result is the way back. Use `--wait` to follow them; without it you get the operation and poll it with `operations get|wait`.

- `backups restore` (permission `backups:restore`) overwrites the site with the backup `ID` from `backups list`; everything written since is lost. `--scope` is required: `full` (whole backup, including WooCommerce orders and customers), `database`, `files` (newer files stay, `wp-config.php` is never replaced) or `folder` (one folder is mirrored to the backup state and files that are not in the backup are **deleted** there; requires `--folder wp-content/uploads`, `wp-content/plugins/SLUG` or `wp-content/themes/SLUG`). `--confirm-host` is required: the exact host of the site being restored (case-insensitive). `--confirm-data-loss` is required by the server for `full` and `database` when WooCommerce is active (or the plugin list is unreadable).
- `core update` (permission `updates:core`) updates WordPress core. `--expected-version` makes the server refuse (`version_changed`) when another version is offered. Without it the offered version is installed.
- `plugins enable|disable` (permission `plugins:manage`) switches one installed plugin (`--plugin SLUG`, exactly one). Short job, no safety backup. The API does not stop you from switching off security or cache plugins or WooCommerce.
- `staging create` (permission `staging:create`) creates the one staging copy `staging.<main domain>` of the live site (`--site` is the live site, `--site` of a staging copy is refused). Live is not changed; it needs free web space. Existing tokens do not know the new site; issue a new token for it (`staging_site_id` in the result).
- `staging push` (permission `staging:push`) overwrites the **live** site with its staging copy; the direction is always staging to live and the copy is determined by the server. Required: `--scope all|files|db|selected` (`selected` needs `--tables a,b`, 1 to 1000 distinct table names that exist in the staging database), exactly one of `--delete-missing-files` (live files without a counterpart in staging are deleted; only with `all` or `files`) and `--no-delete-missing-files`, and `--confirm-host` (the exact live host). `--confirm-data-loss` is required for `all` and `db` when WooCommerce is active on live: orders, customers and comments created on live since the copy was made are lost.
- `staging push --dry-run` changes nothing: the API answers at once (HTTP 200) without a job, without an `Idempotency-Key` (the CLI sends none and rejects `--idempotency-key`, `--wait` and `--timeout`) and without counting against the daily limit. `--delete-missing-files`, `--confirm-host` and `--confirm-data-loss` are optional and only informative. The checks (pair of hosts, WooCommerce, tables, missing tables, backup quota, storage, busy state, daily limit) are printed as readable text, or as the raw JSON with `--json`. Findings are reported, not turned into an error: the exit code is 0. Run the dry run right before the real push; it does not bind the real push to a staging instance.
- Exit codes after `--wait` are as for the other jobs: `failed` is 1, `unknown` is 4. `unknown` always means that the site itself must be checked; the site stays locked until the outcome is clarified (often by support). A restore or push that finished with `health_check` `issue_found` is `succeeded` (exit 0) and prints a warning to stderr.
- API error codes and failed or unknown operation codes (for example `staging_exists`, `storage_insufficient`, `no_core_update`, `version_changed`, `network_activated`, `plugin_not_installed`, `delegation_unavailable`, `service_unavailable`, `staging_ambiguous`, `woo_confirmation_missing`, `copy_outcome_unknown`) are printed with a short hint on stderr, e.g. `API error (HTTP 409, staging_exists, request_id=...); a staging copy ...`. Job results of failed or unknown restore, core, plugin and staging jobs are printed to stdout as well.

**Agency commands (new in 0.6.0).** These use the agency part of the Hosting API and need a token with the matching permissions (`clients:read|write`, `plugins:read`, `work:write`, `licenses:write`, `reports:read|share|send`, `webhooks:manage`) and the agency features enabled for the account; otherwise the API answers `feature_not_enabled` or `permission_denied`. They are synchronous (no `--wait`, no jobs) and every write sends an `Idempotency-Key`, including `PATCH` and `PUT`. IDs are positional arguments. `none` clears a value where the API accepts `null`.

- `clients list|show|create|update|delete`: `create` and `update` take `--name` (unique per account, 1 to 60 characters), `--contact-name`, `--email` (an empty value clears it), `--note`, `--maintenance-contract` and `--send-report` (`true` or `false`), `--quota-minutes` (0 to 65535 or `none`) and `--price-month-cent` (or `none`). `update` needs at least one field. `delete` removes the client **with its work log, reports and share links**; `--confirm` must be the exact client name as shown by `clients show` (case and spaces count, never filled in by the CLI). Its sites stay and become unassigned.
- `sites list --client ID|none` lists only the sites of one client (`none`: sites without client). `sites set-client SITE_ID CLIENT_ID|none` assigns a site or removes the assignment.
- `plugins list` is the plugin fleet across the sites of the token (`--state vulnerable|update|ok|inactive`, `--premium`); `plugins show SLUG` shows one plugin across the sites, `plugins site SITE_ID` the plugins installed on one site. (`plugins enable|disable` from 0.5.0 are unchanged.)
- `licenses list` shows the licence overview per plugin; `licenses set SLUG --paid-by agency|client [--kind TEXT] [--expires YYYY-MM-DD|none]` stores who pays and the expiry. The API never returns licence keys.
- `work list CLIENT_ID [--month YYYY-MM]` reads the work log of one month (default: the current month, Europe/Berlin). `work add` logs work (`--date` not in the future and not older than two years, `--minutes` 5 to 1440, `--text` up to 280 characters, optional `--site` and `--external-id`; the same `--external-id` twice is refused with `duplicate_entry`). `work rm CLIENT_ID ENTRY_ID` deletes an entry.
- `reports list CLIENT_ID` shows the 8 offered periods, `reports show CLIENT_ID PERIOD` the report as JSON (`PERIOD` is `YYYY-MM` or `YYYYQn`). `reports share` creates a public link (valid 90 days, at most 20 valid links per report). `reports send` mails the report to the client address stored in the panel; an already sent report is refused (`already_sent`) unless you add `--resend` (limited: at least 5 minutes apart, 3 resends per period and client).
- `webhooks create|update|delete|test|rotate-secret|list|show|deliveries`: `--events` is a comma-separated list of `operation.succeeded`, `operation.failed`, `site.down`, `site.up`, `plugin.vulnerability_found`, `license.expiring`, `report.sent`, `report.failed` (the `plugin.*`, `license.*` and `report.*` types need the agency features). `--url` must be `https://` on port 443 or 1024 to 65535 with a DNS name. `webhooks update --active true` switches a webhook on again (not possible after `webhook_token_revoked`). `webhooks test` queues a ping; read the result with `webhooks deliveries ID` after about a minute.
- `token` now also shows `scope` (`sites`, `client` with `client_id`, or `account`): what the site list of the token is derived from.

**Secrets are shown once.** The share URL of `reports share` and the signing secret (`whsec_...`) of `webhooks create` and `webhooks rotate-secret` are printed to stdout in the result, a warning goes to stderr, and the CLI never stores or logs them anywhere else (not in errors, not in diagnostics). The API cannot return them again: repeating the same request with the same `Idempotency-Key` answers `secret_not_replayable` (use a new key for a new share link; for a webhook use `webhooks list` and `webhooks rotate-secret`). Do not run these commands in CI logs that you keep.

`--json` writes one JSON value to stdout. List results (including `clients list`, `plugins list`, `licenses list` and `work list`) include `data` and `meta.next_cursor` for pagination. Deletes that the API answers with `204 No Content` print `{"deleted":true}` (`licenses set`: `{"ok":true}`). Other commands write the response `data`. Diagnostics and polling errors go to stderr. Redirects are refused. File uploads use the API's `{path,content,encoding:"base64"}` JSON body; `--path` is a relative destination within the static deployment. Local file paths containing symlinks are rejected; on macOS the standard `/var`, `/tmp` and `/etc` aliases into `/private` are resolved first. The API enforces its own file and byte limits.

`--wait` is available for backup creation, deletion and restore, cache purge, publish, rollback, `updates run`, `core update`, `plugins enable|disable` and `staging create|push|delete` (not for `staging push --dry-run`). The default timeout is 600 seconds and starts before the mutation request. It covers that request, all read attempts, retry delays and polling. The CLI waits at least five seconds between operation GETs and honors a longer `Retry-After` within the remaining deadline. It reports success only when the operation reaches `succeeded`.

Every mutation sends an automatically generated `Idempotency-Key`. If a request or wait fails, stderr includes the key and any known operation ID. Reuse the same key with exactly the same command and payload to resolve an uncertain submission; a new key may create another effect. The server retains keys for 24 hours, after which even the same key can create a new effect. The CLI retries a mutation (POST/PUT/DELETE) only when the API answers HTTP 429 with `rate_limited` or `queue_full`, or HTTP 503 with `api_draining`; in these cases the server guarantees that nothing was created or changed. It retries up to 3 times (4 requests in total) with the same `Idempotency-Key` and the same body, waiting for the `Retry-After` of the response (default 60 seconds for 429 and 120 seconds for 503, at most 300 seconds per wait; with `--wait` all waits count against the `--timeout` deadline; without `--wait` the total retry wait is capped at 600 seconds), and prints a `Waiting ...` line to stderr before each wait. Everything else (for example `daily_limit`, any other 503, other 5xx errors, network errors and timeouts) is never retried and behaves as before. If the outcome is unclear, reuse the same key as described above. Read requests have at most two retries.

| Exit | Meaning |
|---|---|
| 0 | Success |
| 1 | API/network error or failed operation (a failed mutation request can also leave the outcome unknown; reuse the printed idempotency key) |
| 2 | Invalid command or argument |
| 3 | Missing token, authentication or permission error |
| 4 | Timeout or unknown operation outcome |

## Development

```sh
npm ci
npm test
npm run build
npm pack --dry-run
```

`tests/fixtures/openapi.json` pins the WHMCS API contract for standalone route and payload tests. Update it with the server contract when the API changes.

## Releasing

Maintainers release by pushing a tag `vX.Y.Z` that equals the `version` in `package.json`. The tag must point to a commit on `main`.

**Required one-time setup before the first tag** (otherwise the workflow has no approval gate):

1. npm: create the organisation/scope `@turbopress-de` (owned by you, 2FA enabled) and create a granular access token with read+write permission for the `@turbopress-de` scope that may bypass 2FA (npm no longer offers an "automation" token type). A token limited to the single package is impossible before the package exists, and a trusted publisher can only be configured for an existing package. After the first publish, narrow the token to `@turbopress-de/cli` or switch to trusted publishing (npm >= 11.5.1) and delete the token.
2. GitHub environment `npm-publish`: add required reviewer(s), restrict deployments to the tag rule `v*`, and store the token as the environment secret `NPM_TOKEN` (not as a repository-wide secret). With several maintainers, require a reviewer other than the tag pusher ("Prevent self-review"); with a single maintainer leave "Prevent self-review" OFF, otherwise nobody can approve the deployment.
3. GitHub tag ruleset protecting `v*` so only maintainers can create, update or delete such tags.

`release.yml` has two jobs. `build` (no secrets, no environment) validates the tag name, checks that the commit is on `main`, runs `npm ci --ignore-scripts`, tests and build, verifies the tag against `package.json`, and uploads the `npm pack` tarball. `publish` (environment `npm-publish`, after approval) only downloads that tarball and runs `npm publish ./*.tgz --provenance --access public --ignore-scripts` with `NPM_TOKEN`; it never installs or runs dev dependencies. The manual `workflow_dispatch` run only builds the tarball artifact.

`publishConfig.provenance` is enabled, so a local `npm publish` fails outside CI; use `--provenance=false` for an emergency manual publish.

Optional later switch: once the package exists, configure npm trusted publishing (OIDC, requires npm >= 11.5.1, so add an `npm install -g npm@^11.5.1` step) for this workflow and remove `NPM_TOKEN`.
