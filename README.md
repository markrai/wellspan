# Wellspan Foodboard

A dependency-free food planning web app. Its frontend consists of static HTML, CSS, and JavaScript ES modules. Nutritional values describe the portion normally eaten, not necessarily the serving size on a package label.

## Development

Serve this repository over HTTP to load ES modules:

```sh
python3 -m http.server 8080
```

Open http://localhost:8080/. No build step or npm installation is required for the frontend. Node.js is used only for the optional regression tests:

```sh
npm test
npm run check
```

## Files

- `index.html`: accessible markup and food editor
- `src/styles.css`: design and responsive layout
- `src/theme-boot.js`: applies the stored theme before the page is painted
- `src/model.js`: version-1 food data model, defaults, normalization and validation
- `src/app.js`: rendering, editor, meal interactions and browser persistence
- `tests/model.test.js`: schema and data compatibility regression tests

## Data compatibility

The application retains the original `wellspan-foodboard-v1` localStorage key and version-1 JSON backup format, including food IDs, nullable nutrients, notes, and meal references. A refactor must not change these without an explicit, tested migration.

Data remains in the current browser profile. Switching browser, hostname, scheme or port does not automatically transfer it. Export a JSON backup before deployment or moving to a new origin, then import it on the new origin.

## Planned integration

A future optional Vega-hosted API may securely broker image OCR through Lobo and return a validated nutritional-label draft. Editing and manual entry should continue working when Lobo is unreachable. No Lobo networking is implemented in this refactor.
