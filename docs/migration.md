# Migration from browser-local Wellspan to authoritative Vega

Status: **PR #3 experimental client implementation exists; browser acceptance and Vega cutover not completed**.

## A. Prerequisites and inventories

1. Merge and browser-smoke-test PR #1, the dependency-free source split.
2. Export current Wellspan backup JSON from every browser origin/profile that contains data. Record the origin and export date on each backup. Do not assume the same localStorage is shared across a new hostname or port.
3. Choose the canonical backup by comparing food IDs, nutrients, notes, and meal placement. Other profiles are possible divergent edits, not automatic replicas. Review them explicitly.
4. Record a checksum of every backup and keep at least one safe copy outside Vega.
5. Provision Vega with a writable private directory/volume, a regular backup plan and a **tailnet-only** HTTPS endpoint. Verify no public port or Funnel path exists.
6. Verify database initialization, restart persistence, old-revision conflicts and backup/restore in a staging instance.

## B. Initialize authoritative state

1. Launch an isolated staging server. Verify GET /api/v1/state returns revision 0 and null state.
2. Normalize the selected legacy backup using the same version-1 client parser (drop export-only metadata, preserve all IDs, notes, nutrients and meal lists).
3. Explicitly confirm the user chose the canonical backup. POST it to /api/v1/bootstrap.
4. Require revision 1 in the response and GET the board back. Compare normalized content byte-for-byte or field-for-field, including **null versus zero** and meal order.
5. Any existing authoritative revision with a different board causes HTTP 409. Stop. Never replace it implicitly. Investigate whether another device already initialized.
6. Keep the original JSON backup and original localStorage untouched. Server data being authoritative does not require deleting the old browser backup.

## C. Build and qualify the offline PWA (separate PR)

1. Add manifest and service worker limited to app-shell assets. Implement safe update/activation that does not cache API JSON.
2. Implement IndexedDB with stores for `acknowledged`, `projection`, `pendingOps` and `metadata`.
3. Add an explicit one-time migration screen: choose legacy in-origin localStorage or import a JSON backup from another origin, then reconcile against server state.
4. When server has data, treat it as authoritative. Do not auto-bootstrap the current device. Pending changes remain pending until conflict resolution.
5. Make every local edit offline-first with durable IndexedDB transaction; sync with version ETag and surface unsynced state.
6. Never mark a save Synced until server ack. On 409 freeze automatic writes and show a clear compare/resolve flow.
7. Preserve manual edit, theme, drag/reorder, export/import, reset (reset must not reset the server without an explicit server-side workflow), and missing nutrient handling.
8. Run browser acceptance on desktop and phone, under hard reload, airplane mode, Vega restart, stale tabs and simultaneous edits.

## D. Cutover and rollout

1. Run on Vega under a new tailnet HTTPS origin until acceptance is complete.
2. Import one canonical backup, then verify data and offline/online operations on a single client.
3. Connect other clients one at a time; on first run, load the existing server snapshot, not their legacy localStorage. Offer manual import/compare for divergent local data.
4. Confirm the outbox converges and two clients show the same revision after reconnect.
5. After observing successful sync and backups, redirect any old entry URL to the new PWA origin and document the new canonical URL.
6. Do not auto-delete legacy localStorage. Keep a documented fallback window and manual export path.

## E. Acceptance gates

| Case | Expected |
|---|---|
| All 9 nutrient keys | Preserved, including sodium and cholesterol |
| null versus zero | Preserved |
| Existing food identifiers | Preserved, no duplicate or silent renaming |
| Duplicate name / broken meal reference | Rejected before server commit |
| Browser offline, new edit | Visible locally with unsynced indicator; persists on reload |
| Vega unavailable at launch | Last acknowledged board opens; pending operations retained |
| Return online | Only conditional write with known base revision |
| Two clients editing same revision | One succeeds; other gets visible conflict without data loss |
| Retry after lost response | Re-read revision, do not blindly replay full snapshot |
| New origin | Explicit JSON import, no assumptions about localStorage continuity |
| Service worker update | No stale cached API response |
| SQLite restart | Same snapshot and revision |
| Backup restore | Verified schema, data and revision |
| Lobo unavailable | Normal manual entry and offline food planning still work |

## F. Rollback

Before cutover: do not activate server sync; retain legacy frontend and localStorage.

After cutover: stop sync writes, export IndexedDB's acknowledged state and pending queue, take a consistent SQLite backup and inspect discrepancies. Restore previous app assets without rewriting SQLite. Do not replace a newer SQLite snapshot with an older browser export. Re-enable synchronization only after revision and outbox reconciliation.

## PR #3 implementation checkpoint

The offline draft contains the IndexedDB workspace, an atomic local edit journal, an explicit one-time migration interface, revision-controlled synchronization, a conflict resolution UI, an offline app shell and PWA icon assets. The original legacy localStorage data is retained. No data is silently imported into Vega, and 409 conflicts do not automatically overwrite server data.

Browser acceptance, including hard reload, network interruption after a write, multiple tabs, two devices, and actual Vega staging, must be completed before this PR is promoted out of draft. All imports and destructive decisions must be explicitly confirmed. Keep the Vega instance private behind Tailscale Serve, with a verified backup and restore plan before first real-data bootstrap.
