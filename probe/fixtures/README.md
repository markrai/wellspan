# LOBO M3 diagnostic fixtures

The three JSON reports in this directory are byte-exact snapshots of the `lobo.extract.report/v1` examples published in `markrai/lobo-client` under Apache-2.0.

Source: `internal/recipe/contract/testdata/extraction/`, revision `4e4dea79f562dbff05c687289afaebf269586d28`.

| File | SHA-256 |
|---|---|
| supported-nutrition.json | `46c10412799a5b660ae2515e347f37540f8c435064c460bf29151d24bde70a8f` |
| unsupported-quote.json | `38ba15e1967c4d9d5146dc71108a091468d4d22d2c37fce597097765ec8ece76` |
| malformed-answer.json | `72ad65451a57148538122c87220d7ec07f30348a486fbc4d36b4c49f1f055f16` |

The upstream schema snapshot SHA-256 is `d094f77ffd7f8d08d26ea7b37db6bc7966cbd49ef80d590924756b16d35b44ef`.

These interoperability data are not Android implementation code. No fixture is imported into the Wellspan foodboard. See the upstream `PROVENANCE.md` and Apache-2.0 license.
