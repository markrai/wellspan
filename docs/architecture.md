# Wellspan Vega architecture

Status: accepted direction, implementation phased. Updated 2026-11-17.

## Decisions

- Vega is the sole authoritative writer for the Wellspan food library and meal assignments.
- One Go HTTP service serves static vanilla-JS frontend assets and a versioned JSON API from the same origin.
- SQLite is the durable backing store. Initially one validated version-1 Foodboard JSON document per revision, in one row. This is an intentional small-data design; do not add relational tables or per-food APIs without a use case.
- Browsers store a last-confirmed state, the editable local projection, and a durable pending operation journal in IndexedDB. A service worker caches **only versioned static application assets**, never API responses or mutable user state.
- The server controls the monotonically increasing global revision. Initial bootstrap is one-time. All subsequent writes require the last observed ETag. A stale writer receives HTTP 409 and the current server state.
- Initial client conflict behavior is **manual resolution**, not last-writer-wins or automatic whole-snapshot replacement. Per-food optimistic transactions can be considered later if conflict frequency demands it.
- Food, meal, and nutrient data are never sent to Lobo as authoritative writes. Lobo performs inference only; Vega validates extraction output and the user explicitly commits changes.
- No frontend framework or bundler is required. Browser support uses native ES modules and IndexedDB.
- Data is single-user. Vega must be private to the owner's Tailscale tailnet and protected by tailnet ACLs. **Do not enable Tailscale Funnel or publish this HTTP service on a public interface.** Production internet exposure requires authentication and authorization before it is acceptable.

## Trust boundary

Browser → Tailscale Serve HTTPS → localhost-bound Docker port → Go API → SQLite.
A future Go Lobo adapter → pinned-cert HTTPS Lobo/PACK connection on the trusted LAN.

A browser must not call Lobo directly. No CORS wildcard, API tokens, or certificate-validation bypass. An API mutation must have JSON media type and valid same-origin browser metadata when provided. Tailnet access is the network control; it is not the same thing as an application login.

This first backend PR is **not** ready for deployment as an authoritative PWA. Until a separately accepted UI migration, the legacy browser localStorage app remains operational, and the API is not wired into it.

## Data contract

The server accepts the current version-1 JSON shape:

- `version: 1`
- `foods: [{id, name, nutrients, notes}]`
- `meals: {breakfast: [foodId], lunch: [foodId], dinner: [foodId]}`

Nutrient names are `calories`, `protein`, `carbs`, `fat`, `satFat`, `fiber`, `sugars`, `sodium`, and `cholesterol`. Missing values remain JSON null; zero is a meaningful known measurement. Values are stored in the food's normal consumed portion, not necessarily the package serving. Legacy export metadata `exportedAt` and `app` are browser backup metadata and must be stripped during client normalization before an API write.

### HTTP API (foundation only)

| Operation | Request | Behavior |
|---|---|---|
| GET /health | none | local service health |
| GET /api/v1/state | none | `{revision:0,state:null}` before initialization; otherwise latest snapshot and ETag |
| POST /api/v1/bootstrap | version-1 JSON board | atomically initializes an empty database, or returns 409 with current snapshot if different; same snapshot is idempotent |
| PUT /api/v1/state | version-1 JSON board; `If-Match: "rev-N"` | atomic compare-and-swap to revision N+1; returns 409 plus current snapshot on stale revision |

There is no delete-all endpoint or silent forced overwrite endpoint. JSON bodies limited to 2 MiB. Invalid food IDs, duplicate names, unknown meal references, negative/non-finite nutrients, excess entries and unknown fields are rejected.

## Offline client transaction contract (next slice)

1. Fetch IndexedDB's last acknowledged snapshot and pending operations without network, then render immediately.
2. Each food or meal edit changes the local projection and records a uniquely identified operation **in the same IndexedDB transaction**. Never acknowledge user saves before durable local write.
3. When online, fetch authoritative revision, compare with the local base, then submit the projected snapshot with If-Match.
4. On 200, atomically save the returned canonical snapshot, revision, and remove only acknowledged operations.
5. On connection failure, preserve pending operations, show Offline/Unsynced, and let the PWA work.
6. On 409, preserve the pending operation log, show the server state and a conflict UI. Do not automatically discard or overwrite either side.
7. A server state with no pending edits replaces the local acknowledged snapshot. If there are pending edits, rebase only once a tested deterministic merge policy exists; before then require explicit review.

Multi-tab access must coordinate the outbox with Web Locks or an IndexedDB lease to avoid duplicate submission, and must still recover after a tab or worker crash. Network retries must not turn a stale revision into an unconditional update.

## Label extraction plan (later slice)

- Modal accepts paste, drag-and-drop or file select and shows the source image.
- Browser sends one bounded image to an authorized, same-origin Vega endpoint.
- Vega calls Lobo Native ML Kit OCR or Nano OCR through a secure, trusted connection. PACK is optional and cannot be assumed available on Vega.
- Extracted text becomes a typed nutrition record with optional serving size, unit, source engine, and evidence lines. Unreadable or missing fields are null, not zero.
- Validate units and per-serving basis before any prefill. Calories are kcal, sodium/cholesterol mg, other fields g.
- User reviews any serving-size conversion and explicitly saves the food; manual entry works without Lobo.
- Never persist source screenshots by default; transient in-memory processing avoids unintended retention.

## Backup and recovery

- Export legacy browser JSON and keep it separately before import or deployment.
- Keep an offline SQLite backup and a tested restore procedure. An ordinary copy of a live SQLite database in WAL mode is not a safe backup.
- A Vega outage must not replace the local IndexedDB state with an empty default board.
- Rollback must preserve the last acknowledged server snapshot and pending operations; never erase the old localStorage key until explicit decommission acceptance.
