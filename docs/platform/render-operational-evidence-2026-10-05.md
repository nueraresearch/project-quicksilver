# Render operational evidence — 2026-10-05/06

## Scope and evidence boundary

This record captures a **read-only** review of the deployed single-tenant
`quicksilver-host` service before PR #88 was merged. It establishes that the
Render topology was live for health, readiness, and the auxiliary-state
persistence wiring described below. It does **not** prove a production release,
application-data survival through a controlled restart, or any effectful
provider workflow.

- Service: `quicksilver-host`
- Service ID: `srv-db1c5am0tbcc73agc5ng`
- Region / plan / instances: Oregon / Starter / 1
- URL: <https://quicksilver-host.onrender.com>
- Deployment inspected: `dep-db28nhbbc2fs73fmj8c0`
- Commit at inspection: `be2d439caad9eb05fb85b9ea88a127eb52c6deab` (merge of PR #87)
- Dockerfile: `deploy/Dockerfile.host`
- Health endpoint: `/healthz`
- Persistent disk: `quicksilver-data`, 1 GB, mounted at `/data`

> **Important:** PR #88 subsequently added Genesis persistence under
> `/data/genesis`. This record does not claim a post-PR #88 live check; that
> remains the next read-only validation step.

## Results

| Requirement / check | Result | Evidence boundary |
|---|---|---|
| Deployment is live | **Pass** | Render reported the deployment as live after Blueprint synchronization. |
| `GET /healthz` | **Pass** | Returned `{"status":"ok"}`. |
| `GET /readyz` | **Pass** | Returned `{"status":"ready"}`. |
| Unauthenticated `GET /api/whoami` | **Pass** | Returned the expected bearer-token refusal, confirming reachability without exposing a token. |
| Workflow-run persistence | **Partial / ready** | The host code uses PostgreSQL and readiness succeeded. Direct database inspection was unavailable because the database's external IP allowlist was empty. |
| Auxiliary task, intent, and governed-memory wiring | **Pass for configuration and startup warning resolution** | The disk was mounted and the post-deployment logs no longer showed the task or governed-memory in-memory warnings. A controlled sentinel write/restart/read was intentionally not performed. |
| Disk recovery controls | **Manually verified** | The Render disk page showed daily snapshots, seven-day retention, and Restore controls. No restore was invoked. |

## Deployed persistence topology

The observed deployment separates state by durability boundary:

- **PostgreSQL (`DATABASE_URL`)** stores workflow runs and events. The host
  migrates it at startup and `/readyz` performs the readiness check.
- **The Render disk (`/data`)** stores single-tenant auxiliary files, including
  task records, intent graphs and ledger, and governed memory.

This matches the documented topology in [Always-on hosting](always-on-hosting.md)
and [Hosted runtime](hosted-runtime.md). The original inspection found neither
of these warnings after the PR #87 deployment:

```text
Tasks and task clients are kept in memory
```

```text
governed memory is held in memory only and is lost on restart
```

PR #88 extends the same mounted-disk approach to Genesis through
`QUICKSILVER_GENESIS_DIR=/data/genesis`.

## Verification deliberately not performed

The review did not change external state. Therefore it did not:

- write a sentinel task, intent record, memory item, or Genesis record;
- restart the service solely to prove application-data survival;
- alter the PostgreSQL IP allowlist or run external SQL;
- restore a disk snapshot;
- expose or use bearer tokens, vault keys, or provider credentials;
- send email, call a payment API, or accept a real webhook.

These are evidence gaps, not evidence of failure. A controlled sentinel
write/restart/read sequence should be planned separately because it changes
business state and may interrupt a service.

## Recovery procedure observed in the Render UI

1. Stop or safely quiesce writes.
2. Open the Render service's **Disk** page.
3. Select the snapshot timestamp after checking the incident scope.
4. Review Render's warning that changes after that snapshot will be lost.
5. Confirm the restore only under an approved recovery plan.
6. Wait for the service to become live.
7. Recheck `/healthz`, `/readyz`, authenticated identity, and the relevant
   application records.

## References

- [Render service](https://dashboard.render.com/web/srv-db1c5am0tbcc73agc5ng)
- [Render disk](https://dashboard.render.com/web/srv-db1c5am0tbcc73agc5ng/disks)
- [Render persistent disks](https://render.com/docs/disks)
- [Render PostgreSQL backups](https://render.com/docs/postgresql-backups)
- [Always-on hosting](always-on-hosting.md)
- [Hosted runtime](hosted-runtime.md)
