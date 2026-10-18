# TurboPress CLI

Command-line client for the TurboPress Hosting API (`https://panel.turbopress.de/api/v1`). Node.js 22 or newer is required. The CLI uses native `fetch`; no runtime packages or local token configuration are needed. Supported platforms: Linux, macOS and Windows.

The CLI source is public under the MIT license and release builds are published to npm as `@turbopress/cli` (requires Node.js >=22). Until a version appears on npm, build from source.

**Pilot status:** the Hosting API is currently restricted to an explicitly approved pilot account. Other accounts receive an authorization error (HTTP 403, `account_not_enabled`, exit code 3) until the API is activated for them. Installing works for everyone; API commands only succeed for enabled accounts.

## Install and authenticate

Build from source:

```sh
git clone https://github.com/turbopress-de/turbopress-cli.git
cd turbopress-cli
npm ci
npm run build
node dist/bin.js sites list --json
```

Or install a released version from npm (once that version is published):

```sh
npm install --global @turbopress/cli@0.1.0
turbopress --version
# or without a global install:
npx @turbopress/cli@0.1.0 sites list --json
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

1. npm: create the organisation/scope `@turbopress` (owned by you, 2FA enabled) and create a granular or automation access token limited to publishing `@turbopress/cli`. The first publish needs a token because a trusted publisher can only be configured for an existing package.
2. GitHub environment `npm-publish`: add required reviewer(s) (enable "Prevent self-review"), restrict deployments to the tag rule `v*`, and store the token as the environment secret `NPM_TOKEN` (not as a repository-wide secret).
3. GitHub tag ruleset protecting `v*` so only maintainers can create, update or delete such tags.

`release.yml` has two jobs. `build` (no secrets, no environment) validates the tag name, checks that the commit is on `main`, runs `npm ci --ignore-scripts`, tests and build, verifies the tag against `package.json`, and uploads the `npm pack` tarball. `publish` (environment `npm-publish`, after approval) only downloads that tarball and runs `npm publish ./*.tgz --provenance --access public --ignore-scripts` with `NPM_TOKEN`; it never installs or runs dev dependencies. The manual `workflow_dispatch` run only builds the tarball artifact.

`publishConfig.provenance` is enabled, so a local `npm publish` fails outside CI; use `--provenance=false` for an emergency manual publish.

Optional later switch: once the package exists, configure npm trusted publishing (OIDC, requires npm >= 11.5.1, so add an `npm install -g npm@^11.5.1` step) for this workflow and remove `NPM_TOKEN`.
