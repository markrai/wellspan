# LOBO M3 protocol probe and acceptance

Status: read-only browser diagnostics. No food ingestion or permanent LOBO grant.

## Protocol under test

- LOBO Android main `d69d5f0eb1c6699d5af1802558245698f70a6e94` implements `lobo.handoff/v1` (`recipe-schema/handoff-v1.md`).
- The public `lobo.extract.report/v1` contract and fixtures are published in `markrai/lobo-client` at `4e4dea79f562dbff05c687289afaebf269586d28`.
- The requester opens an HTTPS Workbench popup, with the requesting origin and unique UUIDv4 in the fragment, no source bytes in the URL, and no `noopener` because the verified opener relationship is mandatory.
- Workbench emits a no-data `ready` message. The requester checks exact origin, source, protocol and nonce, then sends a pre-existing Recipe ID and a 5 MiB-or-smaller image or 16,384-character-or-smaller text input.
- Only explicit phone-side approval yields a one-use result. The requester rejects mismatched, replayed, oversized, unconfirmed, unknown-version or unsupported-evidence replies.

## What the probe proves

Open private Wellspan HTTPS `/probe/`. First click each bundled fixture. Supported nutrition should produce a read-only draft of calories 185 and protein 4.3; missing sodium must remain null. Unsupported evidence and malformed answer must be marked ineligible.

Then enter a reachable HTTPS Workbench origin. Select `nutrition-label-facts`, choose a real Nutrition Facts label image and open the phone Workbench. Confirm that the origin/Recipe/photo are displayed before approval. Approve once and inspect the report's fields and evidence. Repeat with decline and with a disconnected/closed popup; no result should be accepted. Where available, run the generic `extract-to-json` text Recipe to verify non-nutrition reuse.

Check server state before and after with `curl -fsS http://127.0.0.1:18788/api/v1/state`. It must be unchanged. No result is written to Vega or the Foodboard. This check does not prove nutrition accuracy; inspect the printed label and serving quantities yourself.

## Limitations and safety

The transport is `postMessage`, not an Android HTTP inference API. Do not enable CORS or Funnel. The browser running Wellspan must reach and trust the phone HTTPS origin. Popup blockers, browser opener-isolation policies or TLS validation can prevent the protocol; errors fail closed. Use a direct user gesture. The timeout is for the handoff session only, not a global model-compute budget.

The report does not include the original OCR transcript, native `finishReason` or serving-basis provenance. M3's `completion: confirmed` establishes Recipe runner completion and the Android producer's ingestion eligibility, not numeric correctness. The consumer additionally checks report structure, counts, unique IDs, matched producer evidence and numeric tokens, but must still compare the actual label, serving units and per-usual-portion conversion before any future user-approved save. No food IDs, portions, meal selections, or nutrient values are modified here.

Never initialize the real Vega food library merely to test the handoff. The bundled probes and real phone approval are read-only. The existing offline staging instance may remain at revision 0 until the later ingestion/migration milestone.
