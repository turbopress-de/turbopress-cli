# TurboPress CLI

Command-line client for the TurboPress Hosting API (`https://panel.turbopress.de/api/v1`). Node.js 22 or newer is required. The CLI uses native `fetch`; no runtime packages or local token configuration are needed. Supported platforms: Linux, macOS and Windows.

The CLI source is public under the MIT license and the package is published on npm as `@turbopress/cli` (requires Node.js >=22).

**Pilot status:** the Hosting API is currently restricted to an explicitly approved pilot account. Other accounts receive an authorization error (HTTP 403, `account_not_enabled`, exit code 3) until the API is activated for them. Installing the package works for everyone; API commands only succeed for enabled accounts.

## Install and authenticate

```sh
npm install --global @turbopress/cli
turbopress --version
# or without a global install:
npx @turbopress/cli sites list --json
```

To build from source instead:

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

`tests/fixtures/openapi.json` pins the WHMCS API contract for standalone route and payload tests. Update it with the server contract when the API changes.

## Releasing

Maintainers release by pushing a tag `vX.Y.Z` that equals the `version` in `package.json`. The `release.yml` workflow runs tests and build, verifies the tag, and runs `npm publish --provenance --access public` in the GitHub environment `npm-publish` (configure a required reviewer there). Authentication is either npm trusted publishing (OIDC) or a repository/environment secret `NPM_TOKEN`. The manual `workflow_dispatch` run of the same workflow only builds a tarball artifact.
