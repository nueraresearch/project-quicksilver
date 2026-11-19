# C1 acceptance report

**Status: matrix green on synthetic fixtures — not C1 sign-off.** C0 inputs and owner sign-off remain blocked (below). A green fixture suite is repository evidence, not migration evidence.

- **Command:** `npm run native:c1:test`
- **Script:** `node scripts/native-c1-test.mjs`
- **Commit under test:** `73d1cc9e38c15086b9e9a2cd6ee62b61b0115dab`
- **Artifact commit:** a later, documentation-only commit; the code under test is the commit above.
- **Adapter:** direct native repositories (no external CMS host); in-memory MemoryStore fixture adapter
- **Schema version:** `c1-catalog-89534ac4c00b`
- **Schema catalog digest:** `sha256:89534ac4c00bd19164bd40e900b6ff6aee77a07de334b033a3eea25de0ac5d14`
- **Relation inventory digest:** `sha256:6f7ecc553bfeb8ab8cf2fd74d1ec0ef7a4eba32c689661bdc9190d2884060b64`
- **Fixture manifest digest:** `sha256:44a820f99addc019c18dbd09152d8b1533c5d9c54f103d0e763f6ae734b47b70` (52 tables, row counts only)
- **Timestamp:** 2026-11-19T17:45:50.637Z
- **Counts:** 53 tests, 53 pass, 0 fail, 0 skipped, 0 todo; 50/50 matrix cases reported
- **Redaction:** commands, counts, matrix IDs and digests only; no record bodies, record IDs, tenant names or private paths.

## Gate accounting

| Gate | Cases | Passed | Result |
|---|---:|---:|---|
| A | 4 | 4 | pass |
| B | 11 | 11 | pass |
| C | 8 | 8 | pass |
| D | 6 | 6 | pass |
| E | 8 | 8 | pass |
| F | 6 | 6 | pass |
| G | 7 | 7 | pass |
| **Total** | **50** | **50** | **pass** |

## Matrix IDs exercised

- A: `C1-A01`, `C1-A02`, `C1-A03`, `C1-A04`
- B: `C1-B01`, `C1-B02`, `C1-B03`, `C1-B04`, `C1-B05`, `C1-B06`, `C1-B07`, `C1-B08`, `C1-B09`, `C1-B10`, `C1-B11`
- C: `C1-C01`, `C1-C02`, `C1-C03`, `C1-C04`, `C1-C05`, `C1-C06`, `C1-C07`, `C1-C08`
- D: `C1-D01`, `C1-D02`, `C1-D03`, `C1-D04`, `C1-D05`, `C1-D06`
- E: `C1-E01`, `C1-E02`, `C1-E03`, `C1-E04`, `C1-E05`, `C1-E06`, `C1-E07`, `C1-E08`
- F: `C1-F01`, `C1-F02`, `C1-F03`, `C1-F04`, `C1-F05`, `C1-F06`
- G: `C1-G01`, `C1-G02`, `C1-G03`, `C1-G04`, `C1-G05`, `C1-G06`, `C1-G07`

## Guard-removal provocation

Each guard below was removed in a temporary copy of `quicksilver/`; the unmutated copy passed first, and the named positive control had to fail. A mutation that still passed would fail this report.

| Guard removed | Case that must fail | Caught |
|---|---|---|
| a missing or blank tenant refuses before any read | `C1-A03` | yes |
| queries see only published, non-tombstoned rows | `C1-G01` | yes |
| an inheritance/requirement cycle refuses instead of returning a graph | `C1-G01` | yes |
| a stale expectedRevision is a conflict, not an overwrite | `C1-C01` | yes |
| the same key with a different request is a conflict | `C1-D02` | yes |
| a failed audit/revision append aborts the primary write | `C1-E01` | yes |

## Blocked inputs (not satisfied by this report)

- Signed C0 ownership manifest with zero ambiguous, unresolved or blocked records.
- Production read-only export digest and asset/deletion baseline digest.
- C1 entry bundle (owner + Security reviewer signature) and owner sign-off of the exit bundle.
- Security review confirming the committed evidence is redacted.

## What this does not prove

- Nothing was migrated, imported or tombstoned; no provider status changed and no route is wired.
- The adapter here is the in-memory fixture store, not the production persistence adapter.
- `npm run verify` was not run end to end as part of this artifact; the matrix gate is one stage of it.
