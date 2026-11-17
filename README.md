# Wellspan Foodboard

A small food planning PWA in progress, with a Go + SQLite backend intended to run privately on Vega.

## Current status

The vanilla-JS Foodboard is fully browser-local and uses the `wellspan-foodboard-v1` localStorage key. This branch adds a **server foundation only**. The frontend is not yet connected to SQLite. Do not deploy this branch as the authoritative service or assume that browsing the page synchronizes data.

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
