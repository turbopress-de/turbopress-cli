# TurboPress CLI

Command-line client for the TurboPress Hosting API (`https://panel.turbopress.de/api/v1`). Node.js 22 or newer is required. The CLI uses native `fetch`; no runtime packages or local token configuration are needed. Supported platforms: Linux, macOS and Windows.

The CLI source is public under the MIT license. The package has not been published to npm. The Hosting API is currently enabled only for an explicitly approved pilot account; other accounts cannot use it yet. API activation and npm publication are separate release decisions.

## Install and authenticate

Build the published source checkout; authenticate before running API commands:

```sh
git clone https://github.com/turbopress-de/turbopress-cli.git
cd turbopress-cli
npm ci
npm run build
# Supply TURBOPRESS_API_TOKEN through your secret manager, then:
node dist/bin.js sites list --json
```

After a separate npm publication, install a pinned version:

```sh
npm install --global @turbopress/cli@0.1.0
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
turbopress backups create --site SITE [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress cache purge --site SITE --scope page|object|all [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress operations get ID [--json]
turbopress operations wait ID [--timeout SECONDS] [--json]
turbopress deployments create --site SITE [--idempotency-key KEY] [--json]
turbopress deployments put-file --site SITE --deployment ID --path RELATIVE_PATH --file LOCAL_FILE [--idempotency-key KEY] [--json]
turbopress deployments preview --site SITE --deployment ID [--idempotency-key KEY] [--json]
turbopress deployments publish --site SITE --deployment ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress deployments list --site SITE [--limit 1..100] [--cursor CURSOR] [--json]
turbopress deployments rollback --site SITE --deployment ID [--wait] [--timeout SECONDS] [--idempotency-key KEY] [--json]
turbopress --version
```

`--json` writes one JSON value to stdout. List results include `data` and `meta.next_cursor` for pagination. Other commands write the response `data`. Diagnostics and polling errors go to stderr. Redirects are refused. File uploads use the API's `{path,content,encoding:"base64"}` JSON body; `--path` is a relative destination within the static deployment. Local file paths containing symlinks are rejected; on macOS the standard `/var`, `/tmp` and `/etc` aliases into `/private` are resolved first. The API enforces its own file and byte limits.

`--wait` is available for backup creation, cache purge, publish and rollback. The default timeout is 600 seconds and starts before the mutation request. It covers that request, all read attempts, retry delays and polling. The CLI waits at least five seconds between operation GETs and honors a longer `Retry-After` within the remaining deadline. It reports success only when the operation reaches `succeeded`.

Every mutation sends an automatically generated `Idempotency-Key`. If a request or wait fails, stderr includes the key and any known operation ID. Reuse the same key with exactly the same command and payload to resolve an uncertain submission; a new key may create another effect. The server retains keys for 24 hours, after which even the same key can create a new effect. The CLI never retries a mutation automatically. Read requests have at most two retries.

| Exit | Meaning |
|---|---|
| 0 | Success |
| 1 | API/network error or failed operation |
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

`tests/fixtures/openapi.json` pins the WHMCS API contract for standalone route and payload tests. Update it with the server contract when the API changes. The release workflow only prepares a tarball; publication requires the independent security review, host tests, and an explicit manual release decision.
