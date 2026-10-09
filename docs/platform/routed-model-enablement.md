# Enabling measured model routing in production (P-050)

Measured routing is built and tested but **not enabled anywhere**. This is the
runbook for turning it on in the Render host, and the traps that will refuse
dispatch if you get it wrong.

Read the "Refuses rather than guesses" section before you change anything.

## What turns on when you set these

| Variable | Meaning |
|---|---|
| `QUICKSILVER_ROUTING_CONFIG` | JSON `{ "profiles": [...], "requests": {...} }`. The measured profiles dispatch selects from, and per-role policy overrides. |
| `QUICKSILVER_ROUTING_HISTORY_PATH` | A file path for the durable, append-only outcome log. |

With both set, `withMeasuredProviderFallback` replays the recorded outcomes into
the profile set it hands to `routeForRole`, so dispatch is learned from real
outcomes instead of static configuration alone. The log records model, task,
success, latency and rate-limit signal only — never prompts or model output.

## Refuses rather than guesses

These are the four ways this fails closed. All of them refuse the call; none of
them silently fall back to an unmeasured model.

1. **History path without config.** Setting `QUICKSILVER_ROUTING_HISTORY_PATH`
   without `QUICKSILVER_ROUTING_CONFIG` throws
   `QUICKSILVER_ROUTING_HISTORY_PATH requires QUICKSILVER_ROUTING_CONFIG; refusing unmeasured routing.`
   This is why `deploy/render.yaml` gives the history path no default value.
2. **Changed baseline.** The log stores the digest of the profiles it was
   written against. Editing a profile in `QUICKSILVER_ROUTING_CONFIG` changes
   that digest, and the existing file then fails validation with
   `RoutingHistoryIntegrityError`. Dispatch stops until you delete the stale file
   or roll it back. **Changing profiles invalidates the history.**
3. **Corruption or a stale lock.** A failed digest-chain check or a lock that
   cannot be taken refuses to dispatch rather than dropping the record.
4. **Failed write.** An outcome that cannot be persisted is not silently
   discarded; the call refuses.

## Which calls are affected

The host invokes the measured path in two places, so enabling this changes real
traffic:

- the **query agent** (`packages/agent/src/query.ts`), which the Render host
  runs as its worker, and
- **WAES** Genesis reviews (`packages/agent/src/waes.ts`).

The web console's planner, business agents, assistant and reviewer also use
`withMeasuredProviderFallback`. If you enable this on the Render host only, the
two deployments route independently and each keeps its own history file.

`QUICKSILVER_<ROLE>_MODEL` (an explicit per-role override) wins over all of this:
when it is set, that role bypasses the history entirely. This is a per-role
kill switch.

## Rollout

1. **Set the config only.** Deploy with `QUICKSILVER_ROUTING_CONFIG` and no
   history path. Dispatch uses your profiles; nothing is learned yet. This is the
   step to validate profiles against live traffic with zero durability risk.
2. **Watch one cycle.** Confirm the chosen models and the per-call cost/latency
   look right. Nothing is written to disk in this phase.
3. **Add the history path** on the mounted disk (`/data`, so it survives a
   restart). Routing is now learned.
4. **Re-check after a restart** that the file is still there and dispatch still
   succeeds. A file on the container filesystem instead of `/data` will vanish
   and silently restart learning from zero — the trap here is quiet.

Do not edit profiles once a history file exists without expecting trap 2.

## Kill switch

Any one of these, in increasing order of bluntness:

- **Unset `QUICKSILVER_ROUTING_HISTORY_PATH`** — stops learning, keeps the
  configured profiles. The history file stays on disk for inspection.
- **Unset `QUICKSILVER_ROUTING_CONFIG`** — returns to the previous unmeasured
  behaviour for every role.
- **Set `QUICKSILVER_<ROLE>_MODEL`** — pins one role to one model, bypassing
  routing for that role only.

Note the asymmetry: unsetting only the config while the history path is still set
makes every measured call **throw** (trap 1). Unset the history path first.

## Rollback of a learned history

The log is append-only and a rollback **appends** a rollback entry; it never
rewrites. A rollback requires a named human. To recover from a bad learned state,
stop dispatch (unset the history path), remove or move the file, and re-enable.

## Exercising the API contract without credentials

Not part of routing, recorded here because it is the same fail-closed shape and
the same answer. The response-schema test (P-118) reaches only 4 of 46 routes,
because 42 return 401/503 when Sanity is unconfigured, and every data-backed
route calls `getSanityClient('read').fetch(...)` through a module-level import
the test cannot intercept.

To exercise the rest, the transport has to be injectable. Three ways, cheapest
first:

1. **A stub `fetch` at the client boundary.** `@sanity/client` builds its
   transport from `createClient`, so a test can construct a client with a fake
   `fetch` returning a fixture document. This needs each route to obtain its
   client through something the test can replace, rather than the module-level
   import it uses today.
2. **A seam in `sanity-client.ts`.** Export a setter that installs a test client
   for `read` and `write`. Smallest change, but it puts a test affordance in
   production code, and it must still fail closed when no real client is set.
3. **Recorded fixtures per operation.** Each route gets a checked-in fixture of a
   real response body, and the test validates each fixture against its declared
   schema. This checks the schema against reality with no live dependency, but a
   fixture is only as good as the run that captured it.

Whichever is chosen, two rules hold: the credential-free path stays
credential-free (`AGENTS.md` treats a new credential requirement there as a
regression), and the control test ships in the same change - break one schema,
confirm the suite goes red, revert. Without that control the suite can pass by
skipping every route, which is exactly what it did before this was noticed.

## What this does not prove

Enabling this in production is the remaining step for P-050, which stays
`partial` until there is **evidence of learned routing under live provider
traffic** and the rollback path has been exercised once, for real, by a named
human. Flipping the variables is the setup, not the evidence.