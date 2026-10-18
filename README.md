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

For reproducible setups pin the version, for example `@turbopress-de/cli@0.4.0`. Alternatively build from source:

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
turbopress token [--json]
turbopress status [--json]
turbopress --version
```

`backups delete` removes the backup permanently; the API refuses the newest backup of a site (`backup_protected`) and any backup while a backup is running (`backup_in_use`). `ID` is the backup `id` from `backups list` (1 to 120 characters from `A-Za-z0-9._+:-`, not starting with `-`; file names containing `..` or starting with `.` cannot be deleted via the CLI, delete them in Plesk). `operations list` shows the operations created by the calling token, `--status` is one of `queued`, `running`, `succeeded`, `failed`, `unknown`. `token` shows metadata of the calling token (never the secret). `status` reports the API state (`ok` or `draining`) and is the only command that needs no `TURBOPRESS_API_TOKEN`; it never sends one. It exits 0 for `draining` as well.

`updates list` reads the open plugin, theme and core updates of a WordPress site (permission `updates:read`). The server checks the installation live, so the call can take up to about 100 seconds; the CLI allows 110 seconds for each request attempt. Reads are retried up to twice (timeouts, network errors, HTTP 429/502/503/504), so the worst case is about 5.5 minutes, and the server may run its wp-cli scan up to three times; do not call it in a loop. `updates run` updates plugins and themes only (permission `updates:run`): give 1 to 5 items in total with `--plugin SLUG` and `--theme SLUG`, which may be repeated (slugs: lowercase letters, digits and hyphens, no duplicates). There is no core update and no "update everything". The job creates a safety backup first; with `--wait` the result (`safety_backup` and one status per item: `updated`, `unchanged`, `failed`, `skipped`, `unconfirmed`) is printed, and the exit code is 1 if the job failed or an item failed or was skipped (or has any status other than `updated`/`unchanged`), and 4 if the outcome is unknown or an item is `unconfirmed`. A diagnostic with the affected slugs, the operation ID and the idempotency key goes to stderr. The CLI cannot roll back; restore the safety backup manually.

`staging delete` removes the staging site permanently (permission `staging:delete`, irreversible). `--site` is the live site; `--confirm` is required, has no default and is never derived from the site ID: pass the exact staging host (for example `staging.example.com`, lowercase ASCII, Punycode for international names). The server refuses a mismatch with `confirmation_mismatch` and deletes nothing. `sites list` and `sites show` report `role` (`live` or `staging`) and `staging_of` as returned by the API.

`--json` writes one JSON value to stdout. List results include `data` and `meta.next_cursor` for pagination. Other commands write the response `data`. Diagnostics and polling errors go to stderr. Redirects are refused. File uploads use the API's `{path,content,encoding:"base64"}` JSON body; `--path` is a relative destination within the static deployment. Local file paths containing symlinks are rejected; on macOS the standard `/var`, `/tmp` and `/etc` aliases into `/private` are resolved first. The API enforces its own file and byte limits.

`--wait` is available for backup creation and deletion, cache purge, publish, rollback, `updates run` and `staging delete`. The default timeout is 600 seconds and starts before the mutation request. It covers that request, all read attempts, retry delays and polling. The CLI waits at least five seconds between operation GETs and honors a longer `Retry-After` within the remaining deadline. It reports success only when the operation reaches `succeeded`.

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
