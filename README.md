# Wellspan Foodboard

A small food planning PWA in progress, with a Go + SQLite backend intended to run privately on Vega.

## Current status

PR #3 connects Foodboard edits to an IndexedDB offline workspace and the Go/SQLite API, with an explicit one-time legacy-data migration dialog, a service worker and installable PWA assets. This is still a **draft awaiting full browser acceptance** and has not been deployed to Vega. Do not treat this as a production migration yet. The original `wellspan-foodboard-v1` localStorage key is left untouched.

Migration plan: [docs/migration.md](docs/migration.md). Architecture: [docs/architecture.md](docs/architecture.md).

## Local development

The frontend has no JavaScript runtime dependencies or build step. Node.js is used for tests:

```sh
npm test
npm run check
```

Run the experimental Go server, which serves `index.html`, `src/` and its JSON API from the same origin:

```sh
go test ./...
go run ./cmd/wellspan -db ./data/wellspan.sqlite -static . -listen 127.0.0.1:8080
```

Open http://127.0.0.1:8080/. `/api/v1/state` initially returns `{"revision":0,"state":null}`; it does not populate itself from localStorage.

## Source layout

- `index.html`: Foodboard markup
- `src/styles.css`: CSS design and responsive layout
- `src/theme-boot.js`: stored theme before first paint
- `src/model.js`: version-1 browser data model and validation
- `src/app.js`: current localStorage UI and interaction logic
- `internal/board/`: server-side version-1 JSON validation
- `internal/store/`: SQLite revision and compare-and-swap persistence
- `internal/httpapi/`: same-origin JSON API and static routing
- `cmd/wellspan/`: server entrypoint

## Vega deployment gate

A Compose foundation is provided, binding the container's HTTP listener only to `127.0.0.1:8788` on Vega. Configure **Tailscale Serve**, not Funnel, and restrict tailnet access. The server has no app-level login. Do not make it public.

Do not enable the production instance until offline IndexedDB, migration UI, conflict handling, smoke tests and backups are implemented and accepted.

## Compatibility

The browser localStorage key and version-1 export/import contract remain intact. Existing data is tied to its exact browser origin. Moving hostname or port requires a deliberate export/import; no automatic cross-origin migration exists.

## Validation

CI runs Node tests and Go tests/vet plus a real Docker image smoke test (`tests/container-smoke.sh`). The container smoke test checks its health probe, static serving, 404 behavior and volume-backed restart. Local hardware validation on Vega and verified SQLite backups are still required before activating production.

## Vega staging update

After merging the deployment script PR, run on Vega:

```bash
cd ~/dev/project/wellspan
./deploy.sh
```

This updates `origin/main` fast-forward-only, builds the image before stopping the old staging container, preserves the SQLite volume and localhost port, checks health and attempts image rollback if replacement fails. It does not change Tailscale Serve. See [deployment safeguards](docs/vega-deployment.md).

## LOBO M3 browser compatibility probe

The read-only diagnostic page lives at `/probe/` once this change is deployed. It exercises the `lobo.handoff/v1` one-time browser-to-browser `postMessage` protocol through a user-approved, preinstalled LOBO Workbench Recipe. It is not a CORS endpoint, a new Wellspan API, a PACK integration, or an auto-import feature.

From a Tailscale-connected browser, open the private Wellspan HTTPS origin's `/probe/` path, enter the exact HTTPS origin of a reachable LOBO Workbench, and supply a Nutrition Facts image. Workbench must already contain the bundled `nutrition-label-facts` Recipe, and the user must click approval on the phone. A report is accepted for a **read-only review preview** only after matching origin/opener/request ID, confirmed handoff result and consumer-side structural and evidence checks. The original label and its serving basis still require direct human comparison.

Use the three bundled public fixtures to test report handling without contacting a phone. The client retains neither reports nor images after the page is closed. This probe never sends `POST /api/v1/bootstrap` or `PUT /api/v1/state` and does not modify SQLite, IndexedDB, or `localStorage` food entries.

See [LOBO probe protocol and acceptance](docs/lobo-m3-probe.md).
