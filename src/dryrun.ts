// Readable text form of the staging push dry-run answer. All values come from the server and are
// reduced to printable ASCII; the structure follows StagingPushDryRun in the OpenAPI document.
const clean = (value: unknown): string => String(value).replace(/[^\x20-\x7e]/g, '?').slice(0, 200);
const tri = (value: unknown): string => value === true ? 'yes' : value === false ? 'no' : 'unknown';

export function formatDryRun(data: unknown): string {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const pair = (d.pair && typeof d.pair === 'object' ? d.pair : {}) as Record<string, unknown>;
  const quota = d.backup_quota && typeof d.backup_quota === 'object' ? d.backup_quota as Record<string, unknown> : undefined;
  const tables = Array.isArray(d.tables) ? d.tables : undefined;
  const missing = Array.isArray(d.missing_tables) ? d.missing_tables.slice(0, 50).map(clean) : [];
  const scope = clean(d.scope);
  const findings: string[] = [];
  if (missing.length) findings.push('requested tables missing in staging');
  if (d.busy) findings.push(`site is busy (${clean(d.busy)})`);
  if (d.daily_limit_reached === true) findings.push('daily limit for staging pushes reached');
  if (d.storage_ok === false) findings.push('not enough storage');
  if (quota && Number(quota.used) >= Number(quota.limit)) findings.push('no free backup slot for the safety backup');
  if (['all', 'db'].includes(scope) && d.woocommerce_active !== false) findings.push('WooCommerce is active or unknown: the real push needs --confirm-data-loss');
  const lines = [
    'Dry run: nothing was changed, no job was created.',
    `scope: ${scope}`,
    `delete_missing_files: ${d.delete_missing_files === undefined ? 'unknown' : tri(d.delete_missing_files)}`,
    `staging_host: ${clean(pair.staging_host ?? '?')}`,
    `live_host: ${clean(pair.live_host ?? '?')}`,
    `woocommerce_active: ${tri(d.woocommerce_active)}`,
    `tables_in_staging: ${tables ? tables.length : 'unknown'}${tables && tables.length >= 1000 ? ' (list capped at 1000)' : ''} (use --json for the list)`,
    `missing_tables: ${missing.length ? missing.join(', ') : 'none'}`,
    `backup_quota: ${quota ? `${clean(quota.used)} of ${clean(quota.limit)} used` : 'unknown'}`,
    `storage_ok: ${tri(d.storage_ok)}`,
    `busy: ${d.busy ? clean(d.busy) : 'no'}`,
    `daily_limit_reached: ${tri(d.daily_limit_reached)}`,
    'staging_newer_than_live: not determined by the API',
    findings.length ? 'Findings (the real push would be refused or needs more flags):' : 'Findings: none',
    ...findings.map(finding => `  - ${finding}`),
  ];
  return lines.join('\n') + '\n';
}
