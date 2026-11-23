# turbopress CLI

Command-line client for the turbopress Hosting API (`https://panel.turbopress.de/api/v1`). Node.js 22 or newer is required. The CLI uses native `fetch`; no runtime packages or local API key configuration are needed. Supported platforms: Linux, macOS and Windows.

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

For reproducible setups pin the version, for example `@turbopress-de/cli@0.6.1`. Alternatively build from source:

```sh
git clone https://github.com/turbopress-de/turbopress-cli.git
cd turbopress-cli
npm ci
npm run build
node dist/bin.js sites list --json
```

Create an API key (sometimes called token) with the permissions you need and pass it in the environment variable `TURBOPRESS_API_TOKEN`; the variable name stays as it is. The CLI accepts no key argument, key file, alternate endpoint or URL override. Keep the variable in your shell's secret manager or CI secret store; do not place it in scripts, command lines, logs or repository files.

```sh
export TURBOPRESS_API_TOKEN='...'
turbopress sites list --json
```

For CI, inject the API key as a masked secret into the step environment. Pin the published package version and use Node.js 22 or newer. An API key can be revoked independently of any SSH key used for WordPress code deployment.

## Commands

```text
turbopress sites list [--limit 1..100] [--cursor CURSOR] [--json]
turbopress sites show --site SITE [--json]
turbopress backups list --site SITE [--limit 1..100] [--cursor CURSOR] [--json]
turbopress backups delete --site SITE --backup ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress backups server-list --site SITE [--json]
turbopress backups server-restore --site SITE --time BACKUP_TIME --scope all|db|files [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
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
turbopress plugins install --site SITE --plugin SLUG [--activate] [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress core check --site SITE [--json]
turbopress php show --site SITE [--json]
turbopress php set --site SITE --php-version X.Y [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress php-test start --site SITE --php-version X.Y [--idempotency-key KEY] [--json]
turbopress php-test status --site SITE [--json]
turbopress php-test apply --site SITE [--despite-warning] [--idempotency-key KEY] [--json]
turbopress php-test discard --site SITE [--idempotency-key KEY] [--json]
turbopress debug show --site SITE [--json]
turbopress debug on|off --site SITE [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress site diagnose --site SITE [--json]
turbopress site repair --site SITE --proposal ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress site profile --site SITE [--path PATH] [--keep-plugin] [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress staging create --site LIVE_SITE [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress staging refresh --site LIVE_SITE --scope all|db|files [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
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

`backups delete` removes the backup permanently; the API refuses the newest backup of a site (`backup_protected`) and any backup while a backup is running (`backup_in_use`). `ID` is the backup `id` from `backups list` (1 to 120 characters from `A-Za-z0-9._+:-`, not starting with `-`; file names containing `..` or starting with `.` cannot be deleted via the CLI, delete them in Plesk). `operations list` shows the operations created by the calling API key, `--status` is one of `queued`, `running`, `succeeded`, `failed`, `unknown`. `token` shows the API key you are using (metadata only, never the secret). `status` reports the API state (`ok` or `draining`) and is the only command that needs no API key; it never sends one. It exits 0 for `draining` as well.

`updates list` reads the open plugin, theme and core updates of a WordPress site (permission `updates:read`). The server checks the installation live, so the call can take up to about 100 seconds; the CLI allows 110 seconds for each request attempt. Reads are retried up to twice (timeouts, network errors, HTTP 429/502/503/504), so the worst case is about 5.5 minutes, and the server may run its wp-cli scan up to three times; do not call it in a loop. `updates run` updates plugins and themes only (permission `updates:run`): give 1 to 5 items in total with `--plugin SLUG` and `--theme SLUG`, which may be repeated (slugs: lowercase letters, digits and hyphens, no duplicates). There is no core update and no "update everything". The job creates a safety backup first; with `--wait` the result (`safety_backup` and one status per item: `updated`, `unchanged`, `failed`, `skipped`, `unconfirmed`) is printed, and the exit code is 1 if the job failed or an item failed or was skipped (or has any status other than `updated`/`unchanged`), and 4 if the outcome is unknown or an item is `unconfirmed`. A diagnostic with the affected slugs, the operation ID and the idempotency key goes to stderr. The CLI cannot roll back; restore the safety backup manually.

`staging delete` removes the staging site permanently (permission `staging:delete`, irreversible). `--site` is the live site; `--confirm` is required, has no default and is never derived from the site ID: pass the exact staging host (for example `staging.example.com`, lowercase ASCII, Punycode for international names). The server refuses a mismatch with `confirmation_mismatch` and deletes nothing. `sites list` and `sites show` report `role` (`live` or `staging`) and `staging_of` as returned by the API.

**Destructive commands (new in 0.5.0).** `backups restore` and `staging push` overwrite a live site; `core update` changes WordPress itself. None of them has a default for anything that overwrites or deletes data: every such choice is a mandatory flag, and the confirmation of the host is never filled in by the CLI. All three run as jobs and create a safety backup first (it needs a free backup slot); there is no automatic rollback, the safety backup named in the result is the way back. Use `--wait` to follow them; without it you get the operation and poll it with `operations get|wait`.

- `backups restore` (permission `backups:restore`) overwrites the site with the backup `ID` from `backups list`; everything written since is lost. `--scope` is required: `full` (whole backup, including WooCommerce orders and customers), `database`, `files` (newer files stay, `wp-config.php` is never replaced) or `folder` (one folder is mirrored to the backup state and files that are not in the backup are **deleted** there; requires `--folder wp-content/uploads`, `wp-content/plugins/SLUG` or `wp-content/themes/SLUG`). `--confirm-host` is required: the exact host of the site being restored (case-insensitive). `--confirm-data-loss` is required by the server for `full` and `database` when WooCommerce is active (or the plugin list is unreadable).
- `backups server-list` (permission `backups:read`) lists the **server backups**: the daily backups of the whole package that can be restored, newest first, as `{data, meta}` with `backup_time` (ISO 8601 with offset, server time Europe/Berlin), `warning` (single files could not be saved that day) and `metrics` (counts of the site that day). Live site only, no paging. Only for accounts the feature is enabled for (`not_available` otherwise).
- `backups server-restore` (permission `backups:restore`) **overwrites the live site** with the server backup `--time` (a `backup_time` of `backups server-list`, ISO 8601 with offset; no other form). `--scope all|db|files` is required and has no default: `all` is files and database, `db` only the database, `files` only the files; with `all` and `files` the site folder is emptied first (`wp-config.php` stays), so everything else in it is reset too, and the site is unreachable for some minutes. Mailboxes, DNS and the rest of the package stay. Everything written since is lost (with `all` and `db` also WooCommerce orders and customers). There is no `--confirm-host`: the `Idempotency-Key` is the confirmation. A safety backup is created first (if that fails nothing is restored); if the restore fails after the site was changed it is put back automatically. Job with `--wait`; it may wait for the nightly backup (01:45 to about 04:00) or another restore on the server, so give a long `--timeout` (up to 5 hours). Limit: 2 a day and account, shared with WP Cockpit, turbopress AI and MCP. The result has `backup_time`, `scope`, `safety_backup`, `object_cache_flushed`, `page_cache_purged`, `reachable`, `wp_config_restored` and `dns_unchanged` (each `true`, `false` or null); a step that did not confirm is `succeeded` (exit 0) and prints a note to stderr. `failed` (exit 1) means the site is as before or was put back; `unknown` (exit 4: `restore_outcome_unknown`, `restore_rollback_pending`, `restore_rollback_failed`) means check the site, the package stays busy until the outcome is clarified.
- `core update` (permission `updates:core`) updates WordPress core. `--expected-version` makes the server refuse (`version_changed`) when another version is offered. Without it the offered version is installed.
- `plugins enable|disable` (permission `plugins:manage`) switches one installed plugin (`--plugin SLUG`, exactly one), no safety backup. `disable` is a short job; the API does not stop you from switching off security or cache plugins or WooCommerce. `enable` runs as a WP Cockpit job with a function check of the site before and after (usually under a minute, at most about 6 minutes): if the site shows errors afterwards, the plugin is switched off again at once and the job fails with `activation_rolled_back` (the result has `rolled_back: true`, `reason` and a plain-text `message`). Do not enable it again before the cause is fixed.
- `plugins install` (permission `plugins:install`) installs one plugin from wordpress.org (`--plugin SLUG`: lowercase letters, digits, hyphens). It is never activated by the install itself; with `--activate` it is then enabled with the same function check. The result has `installed`, `activated`, `checked`, `rolled_back` and `message`. A failed activation leaves the plugin installed. 30 installs a day.
- `core check` (permission `integrity:read`) checks the WordPress core files against the official checksums (read only, a few seconds): `checkable`, `unchanged`, `counts` and the lists `modified_files`, `missing_files`, `extra_files` (relative names, at most 200 each). `checkable: false` means there are no checksums for this version; it is never a clean result. Repairing the core is not possible through the API.
- `php show` (permission `php:read`) reads the PHP version of exactly this site: the main domain of the package has the package's handler, an add-on domain or subdomain (also the staging copy) its own; a WordPress in a subfolder shares the handler of its host (`applies_to`). `available_versions` are the values `php set` accepts.
- `php set --php-version 8.4` (permission `php:write`) switches the PHP version as a job and reads it back (result `version`, `previous_version`, `changed`). It takes effect at once and is not tested; a wrong version can break the site (switch back with the old version). `php_version_change_failed` (exit 1) means nothing changed, `php_version_unconfirmed` (exit 4) means check the site.
- `php-test start --php-version 8.5` (permission `php_test:write`) tests a PHP version on a disposable copy of the site; the live site is not touched. The command returns at once (the test runs on the server, usually a few minutes); follow it with `php-test status` (permission `php_test:read`): `phase` goes from `copy_*` to `awaiting_decision` with `result` `recommended` or `not_recommended` and the findings. `php-test apply` then **switches the live site** to the tested version; it is checked before and after and switched back automatically if it shows new errors (`result` `switched` or `rolled_back` in `php-test status`). `--despite-warning` is required when the test advised against it. `php-test discard` drops a waiting report. Limits: 3 tests per site and 10 per account within 24 hours (`daily_limit`). Only for accounts with the PHP test (`php_test_not_enabled` otherwise).
- `debug show` / `debug on` / `debug off` (permissions `debug:read`, `debug:write`): `WP_DEBUG` for 24 hours with log and display off (messages go to the server error log, visitors see nothing), then switched off automatically; `debug off` restores the previous values. `debug on|off` is a job (`--wait`); 20 switches a day, a call without effect does not count. `debug_not_restorable` means wp-config.php sets the values itself: change them there.
- `site diagnose` (permission `sites:read`) finds the PHP fatal error that takes the site down (error logs of the last 2 hours, read only): `finding` (`kind` plugin, theme, core, memory, time_limit, mu_plugin, drop_in, unknown or none; `slug`, `name`, `since`, `count`, `certainty`), `proposal` (`id`, `action`, `target_theme`, `backup`) and at most 3 log `lines` (text from the website). `proposal.id` is set only for the four repairs `rollback_plugin` (previous version of the plugin from our own safety backup), `deactivate_plugin`, `switch_theme` (the site looks different) and `repair_core`; it is valid 15 minutes. Only for accounts with the repair feature (`repair_not_enabled` otherwise).
- `site repair --proposal ID` (permission `sites:repair`) applies exactly that proposal as a job, checks the site afterwards and undoes a deactivation or theme switch that did not help. Result `{outcome, next_proposal}`: `fixed` (exit 0 with `--wait`; a deactivated plugin stays off until you switch it on in the WP Cockpit), `reverted` (exit 1; `next_proposal` is the next proposal of a fresh diagnosis), `unverifiable` (exit 4; applied, check the site yourself). `diagnosis_changed` means the site changed or the proposal is older than 15 minutes: run `site diagnose` again. 10 repairs a day (shared with turbopress AI and MCP), at most 3 per site and hour.
- `site profile` (permission `sites:profile`) measures the load time of one page (`--path`, default `/`) as a job: time per plugin, theme and WordPress core, the slowest database queries and external HTTP calls (names, SQL and hosts are text from the website). It installs the plugin "turbopress Diagnostics" temporarily and restores the previous plugin state afterwards (`--keep-plugin` leaves it installed and active). With `--wait` the exit code is 0 (measured), 1 (failed) or 4 (unknown: check the plugin list). 10 measurements a day (shared with turbopress AI and MCP); `profile_not_enabled` for accounts without the feature.
- `staging create` (permission `staging:create`) creates the one staging copy `staging.<main domain>` of the live site (`--site` is the live site, `--site` of a staging copy is refused). Live is not changed; it needs free web space. Existing API keys do not know the new site; issue a new API key for it (`staging_site_id` in the result).
- `staging refresh` (permission `staging:refresh`) overwrites the **staging** copy with the current live state; live is not changed. `--site` is the live site (a staging copy is refused), the copy is determined by the server. Required: `--scope all|db|files` (no `selected`). Job, supports `--wait`; limit: 5 per day and account, shared with WP Cockpit, turbopress AI and MCP. The result has `staging_host`, `scope`, `search_engines_hidden`, `environment_staging`, `object_cache_flushed`, `page_cache_purged` and `reachable` (true, false or null when not checked; `page_cache_purged` covers only the LiteSpeed Cache page entries of the staging and is null when LiteSpeed Cache is not active there or too old), and `maintenance_page` (see `staging push`; here for the staging's `wp-content/maintenance.php`). With an unknown outcome `search_engines_hidden` is null (not checked) and `environment_staging` is still set.
- `staging push` (permission `staging:push`) overwrites the **live** site with its staging copy; the direction is always staging to live and the copy is determined by the server. Required: `--scope all|files|db|selected` (`selected` needs `--tables a,b`, 1 to 1000 distinct table names that exist in the staging database), exactly one of `--delete-missing-files` (live files without a counterpart in staging are deleted; only with `all` or `files`) and `--no-delete-missing-files`, and `--confirm-host` (the exact live host). `--confirm-data-loss` is required for `all` and `db` when WooCommerce is active on live: orders, customers and comments created on live since the copy was made are lost. The result also has `maintenance_page`: WP Toolkit copies `wp-content/maintenance.php` along, so the job saves the file of the target before the copy and puts it back afterwards; `restored` (own file written back), `removed` (the target had none, the copied one is deleted), `unchanged`, `not_verified` (not proven, for example with an unknown outcome; the maintenance page may still point to the other copy, which matters only in maintenance mode or during an update) or null (no files copied). It is missing on operations finished before the server added it, and on a push whose run stopped before the copy (nothing was copied, so there is nothing to report).
- `staging push --dry-run` changes nothing: the API answers at once (HTTP 200) without a job, without an `Idempotency-Key` (the CLI sends none and rejects `--idempotency-key`, `--wait` and `--timeout`) and without counting against the daily limit. `--delete-missing-files`, `--confirm-host` and `--confirm-data-loss` are optional and only informative. The checks (pair of hosts, WooCommerce, tables, missing tables, backup quota, storage, busy state, daily limit) are printed as readable text, or as the raw JSON with `--json`. Findings are reported, not turned into an error: the exit code is 0. Run the dry run right before the real push; it does not bind the real push to a staging instance.
- Exit codes after `--wait` are as for the other jobs: `failed` is 1, `unknown` is 4. `unknown` always means that the site itself must be checked; the site stays busy until the outcome is clarified (after a push or restore often by support). After `staging refresh` the live site is unchanged: check the staging copy; the package stays busy (`site_busy`) for about 30 minutes. A restore or push that finished with `health_check` `issue_found` is `succeeded` (exit 0) and prints a warning to stderr.
- API error codes and failed or unknown operation codes (for example `staging_exists`, `storage_insufficient`, `no_core_update`, `version_changed`, `network_activated`, `plugin_not_installed`, `delegation_unavailable`, `service_unavailable`, `staging_ambiguous`, `woo_confirmation_missing`, `copy_outcome_unknown`) are printed with a short hint on stderr, e.g. `API error (HTTP 409, staging_exists, request_id=...); a staging copy ...`. Job results of failed or unknown restore, core, plugin and staging jobs are printed to stdout as well.

**Agency commands (new in 0.6.0).** These use the agency part of the Hosting API and need an API key with the matching permissions (`clients:read|write`, `plugins:read`, `work:write`, `licenses:write`, `reports:read|share|send`, `webhooks:manage`) and the agency features enabled for the account; otherwise the API answers `feature_not_enabled` or `permission_denied`. They are synchronous (no `--wait`, no jobs) and every write sends an `Idempotency-Key`, including `PATCH` and `PUT`. IDs are positional arguments. `none` clears a value where the API accepts `null`.

- `clients list|show|create|update|delete`: `create` and `update` take `--name` (unique per account, 1 to 60 characters), `--contact-name`, `--email` (an empty value clears it), `--note`, `--maintenance-contract` and `--send-report` (`true` or `false`), `--quota-minutes` (0 to 65535 or `none`) and `--price-month-cent` (or `none`). `update` needs at least one field. `delete` removes the client **with its work log, reports and share links**; `--confirm` must be the exact client name as shown by `clients show` (case and spaces count, never filled in by the CLI). Its sites stay and become unassigned.
- `sites list --client ID|none` lists only the sites of one client (`none`: sites without client). `sites set-client SITE_ID CLIENT_ID|none` assigns a site or removes the assignment.
- `plugins list` is the plugin fleet across the sites of the API key (`--state vulnerable|update|ok|inactive`, `--premium`); `plugins show SLUG` shows one plugin across the sites, `plugins site SITE_ID` the plugins installed on one site. (`plugins enable|disable` from 0.5.0 are unchanged.)
- `licenses list` shows the licence overview per plugin; `licenses set SLUG --paid-by agency|client [--kind TEXT] [--expires YYYY-MM-DD|none]` stores who pays and the expiry. The API never returns licence keys.
- `work list CLIENT_ID [--month YYYY-MM]` reads the work log of one month (default: the current month, Europe/Berlin). `work add` logs work (`--date` not in the future and not older than two years, `--minutes` 5 to 1440, `--text` up to 280 characters, optional `--site` and `--external-id`; the same `--external-id` twice is refused with `duplicate_entry`). `work rm CLIENT_ID ENTRY_ID` deletes an entry.
- `reports list CLIENT_ID` shows the 8 offered periods, `reports show CLIENT_ID PERIOD` the report as JSON (`PERIOD` is `YYYY-MM` or `YYYYQn`). `reports share` creates a public link (valid 90 days, at most 20 valid links per report). `reports send` mails the report to the client address stored in the panel; an already sent report is refused (`already_sent`) unless you add `--resend` (limited: at least 5 minutes apart, 3 resends per period and client).
- `webhooks create|update|delete|test|rotate-secret|list|show|deliveries`: `--events` is a comma-separated list of `operation.succeeded`, `operation.failed`, `site.down`, `site.up`, `plugin.vulnerability_found`, `license.expiring`, `report.sent`, `report.failed` (the `plugin.*`, `license.*` and `report.*` types need the agency features). `--url` must be `https://` on port 443 or 1024 to 65535 with a DNS name. `webhooks update --active true` switches a webhook on again (not possible after `webhook_token_revoked`). `webhooks test` queues a ping; read the result with `webhooks deliveries ID` after about a minute.
- `turbopress token` now also shows `scope` (`sites`, `client` with `client_id`, or `account`): what the site list of the API key is derived from.

**Secrets are shown once.** The share URL of `reports share` and the signing secret (`whsec_...`) of `webhooks create` and `webhooks rotate-secret` are printed to stdout in the result, a warning goes to stderr, and the CLI never stores or logs them anywhere else (not in errors, not in diagnostics). The API cannot return them again: repeating the same request with the same `Idempotency-Key` answers `secret_not_replayable` (use a new key for a new share link; for a webhook use `webhooks list` and `webhooks rotate-secret`). Do not run these commands in CI logs that you keep.

`--json` writes one JSON value to stdout. List results (including `clients list`, `plugins list`, `licenses list` and `work list`) include `data` and `meta.next_cursor` for pagination. Deletes that the API answers with `204 No Content` print `{"deleted":true}` (`licenses set`: `{"ok":true}`). Other commands write the response `data`. Diagnostics and polling errors go to stderr. Redirects are refused. File uploads use the API's `{path,content,encoding:"base64"}` JSON body; `--path` is a relative destination within the static deployment. Local file paths containing symlinks are rejected; on macOS the standard `/var`, `/tmp` and `/etc` aliases into `/private` are resolved first. The API enforces its own file and byte limits.

`--wait` is available for backup creation, deletion and restore, cache purge, publish, rollback, `updates run`, `core update`, `plugins enable|disable|install` and `staging create|push|delete` (not for `staging push --dry-run`). The default timeout is 600 seconds and starts before the mutation request. It covers that request, all read attempts, retry delays and polling. The CLI waits at least five seconds between operation GETs and honors a longer `Retry-After` within the remaining deadline. It reports success only when the operation reaches `succeeded`.

Every mutation sends an automatically generated `Idempotency-Key`. If a request or wait fails, stderr includes the key and any known operation ID. Reuse the same key with exactly the same command and payload to resolve an uncertain submission; a new key may create another effect. The server retains keys for 24 hours, after which even the same key can create a new effect. The CLI retries a mutation (POST/PUT/DELETE) only when the API answers HTTP 429 with `rate_limited` or `queue_full`, or HTTP 503 with `api_draining`; in these cases the server guarantees that nothing was created or changed. It retries up to 3 times (4 requests in total) with the same `Idempotency-Key` and the same body, waiting for the `Retry-After` of the response (default 60 seconds for 429 and 120 seconds for 503, at most 300 seconds per wait; with `--wait` all waits count against the `--timeout` deadline; without `--wait` the total retry wait is capped at 600 seconds), and prints a `Waiting ...` line to stderr before each wait. Everything else (for example `daily_limit`, any other 503, other 5xx errors, network errors and timeouts) is never retried and behaves as before. If the outcome is unclear, reuse the same key as described above. Read requests have at most two retries.

| Exit | Meaning |
|---|---|
| 0 | Success |
| 1 | API/network error or failed operation (a failed mutation request can also leave the outcome unknown; reuse the printed idempotency key) |
| 2 | Invalid command or argument |
| 3 | Missing API key, authentication or permission error |
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

1. npm: on the package page of `@turbopress-de/cli`, Settings, add a trusted publisher: GitHub Actions, organization `turbopress-de`, repository `turbopress-cli`, workflow `release.yml`, environment `npm-publish`. No npm token is used (since 0.7.0); the publish job authenticates with GitHub's OIDC identity (`id-token: write`, npm >= 11.5.1). For a brand-new package, the first version still needs a token or a manual publish, because a trusted publisher can only be set for an existing package.
2. GitHub environment `npm-publish`: add required reviewer(s), restrict deployments to the tag rule `v*`, no secret is needed. With several maintainers, require a reviewer other than the tag pusher ("Prevent self-review"); with a single maintainer leave "Prevent self-review" OFF, otherwise nobody can approve the deployment.
3. GitHub tag ruleset protecting `v*` so only maintainers can create, update or delete such tags.

`release.yml` has two jobs. `build` (no secrets, no environment) validates the tag name, checks that the commit is on `main`, runs `npm ci --ignore-scripts`, tests and build, verifies the tag against `package.json`, and uploads the `npm pack` tarball. `publish` (environment `npm-publish`, after approval) only downloads that tarball and updates npm to a version with trusted publishing and runs `npm publish ./*.tgz --provenance --access public --ignore-scripts` via OIDC; it never installs or runs dev dependencies. The manual `workflow_dispatch` run only builds the tarball artifact.

`publishConfig.provenance` is enabled, so a local `npm publish` fails outside CI; use `--provenance=false` for an emergency manual publish.

The former `NPM_TOKEN` environment secret is no longer used and can be deleted.
