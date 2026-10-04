# Judge demo: a public deployment on synthetic data

A public deployment where anyone can try Nuera Quicksilver without an account, with nothing private
behind it. It is a second deployment of the same app, switched into **demo mode**, pointed at a
**synthetic, public dataset**, and with its own Context MCP endpoints. Production is not touched.

Nothing on this page has been done yet. It is the runbook, in the order to do it.

## What demo mode is, and what keeps it safe

With `NEXT_PUBLIC_QUICKSILVER_DEMO_MODE=on` the sign-in page offers two public demo accounts from the
synthetic seed company: **Marcus Webb** (`developer`: plans and requests) and **Sarah Chen** (`supervisor`:
approves, executes, rolls back). Their tokens are public on purpose. A top bar says whose account you are
using and switches to the other in one press. Separation of duties is shown working: Marcus cannot
approve and Sarah cannot propose.

Public tokens are only safe because demo mode refuses to run unless **all** of these hold (checked at
startup and on every request; a failed check makes routes answer 503):

- `NEXT_PUBLIC_SANITY_DATASET` starts with `demo` or `challenge` and is never `production`.
- `SANITY_DATASET_PUBLIC=on`: the dataset is public, so nothing private can be in it.
- `SANITY_CONTEXT_MCP_URL` and `SANITY_CONTEXT_KB_MCP_URL`, when set, name endpoints whose **name contains
  `demo`**, so a copied environment can never point a guest chat at the production endpoints.
- None of these is set: `QUICKSILVER_PRINCIPALS`, `NQC_SUPERVISOR_TOKEN`, `NQC_SUPERVISOR_ID`,
  `QUICKSILVER_SOLE_OPERATOR_ID`, `QUICKSILVER_ALLOW_FAULT_INJECTION`, `QUICKSILVER_WORKFLOW_LIVE_RUNS`,
  `SANITY_AUTH_TOKEN`, `OIDC_CLIENT_SECRET`.

`npm run demo:reset` (and the reset steps below) refuse to run against anything else.

## 1. Sanity: the demo dataset

Run from `apps/studio` with the demo values in the shell (never in a file you commit):

```bash
export NEXT_PUBLIC_SANITY_PROJECT_ID=<project id>          # f87t11g1 for the Nuera project
export NEXT_PUBLIC_SANITY_DATASET=demo
export SANITY_STUDIO_DATASET=demo
export SANITY_DATASET_PUBLIC=on
export NEXT_PUBLIC_QUICKSILVER_DEMO_MODE=on
export SANITY_WRITE_TOKEN=<Editor token>                    # enter it yourself; do not paste it into chat
npx sanity dataset create demo --visibility public          # skip if it exists; confirm with: npx sanity dataset list
npm run seed                                                # from the repository root
npm run seed:processes
npm run smoke                                               # needs SANITY_READ_TOKEN, or SANITY_DATASET_PUBLIC=on
```

**Isolation, honestly.** Sanity tokens belong to a project, not to one dataset, so an Editor token for
`f87t11g1` could write to `production` if the code were ever misconfigured. The guard above makes that fail
closed, but the stronger setup is a **separate Sanity project** just for the demo: its tokens cannot reach
production at all. It costs extra setup (a deployed Studio for that project, because Context endpoints read
the schema from a deployed Studio). If you have the time, do that; if not, the same-project `demo` dataset
works and the judge-facing project ID is then `f87t11g1` with the public `demo` dataset.

## 2. Sanity: Context endpoints for the demo

In the Sanity dashboard (Context), create **new** ones. Names cannot be changed later, and **must contain
`demo`** or demo mode will refuse to start:

1. GROQ-mode endpoint `nuera-quicksilver-demo-agent`, source dataset `<project>/demo`.
2. A knowledge base over the `evidence` and `policy` documents of `<project>/demo`; build its entries, wait for
   "Entries up to date".
3. KB-mode endpoint `nuera-quicksilver-demo-kb` with that knowledge base as its only source.

Then `SANITY_CONTEXT_MCP_URL` and `SANITY_CONTEXT_KB_MCP_URL` on the demo deployment are these two, and
`npm run verify:mcp` should show the demo knowledge base id.

## 3. Models and cost

Judges' chat and plans call a model. The per-person rate limit (burst 5, then 10 a minute per principal) is
shared by everyone, because every judge is Marcus or Sarah. That protects against a burst but it is **not a
daily cap**. Put the real cap at the provider:

- Use a **separate Azure OpenAI deployment** for the demo, with a low tokens-per-minute quota.
- Add an **Azure Cost Management budget** with an alert (and, if you want it hard, an action that disables the
  deployment) on the resource group that holds it.

Set `AZURE_API_KEY` and `AZURE_RESOURCE_NAME` for that deployment on the demo project only.

## 4. Vercel: a second project

Create a second Vercel project from this repository (root directory `apps/web`). Do not reuse the production
project's variables. Set, on **Production** for the demo project:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_QUICKSILVER_DEMO_MODE` | `on` |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` | the project id |
| `NEXT_PUBLIC_SANITY_DATASET` | `demo` |
| `SANITY_DATASET_PUBLIC` | `on` |
| `QUICKSILVER_TENANT_ID` | `nuera` (the seed company's tenant; must match the seed) |
| `SANITY_WRITE_TOKEN` | Editor token (decisions and evaluations are written here) |
| `SANITY_CONTEXT_MCP_URL` / `SANITY_CONTEXT_KB_MCP_URL` / `SANITY_CONTEXT_TOKEN` | the demo endpoints and a Context Viewer token |
| `AZURE_API_KEY`, `AZURE_RESOURCE_NAME` | the demo model deployment |

Leave every variable in the "none of these" list above unset. After deploying, open `/sign-in`: you should
see "Try it as a judge". If instead routes answer 503, the response names what demo mode refused.

## 5. Check it works before anyone else does

1. `/sign-in` → **Start as Marcus Webb**. The bar says "You are Marcus Webb".
2. In the chat ask *"Which policies apply to production parameter changes?"* and open **What I looked at**:
   it should list a knowledge-base entry or a dataset query.
3. Ask it to plan something and press **Create plan** on the card. The checklist shows its steps, and a decision
   appears under Decisions.
4. **Switch to Sarah Chen**; open the decision, read the why, approve it. Marcus trying the same is refused.
5. As Sarah (the supervisor role includes `audit:read`), press **Download audit trail** on the decision: you get a JSON
   file with a digest. As Marcus the button is disabled and says it needs `audit:read`: that is the permission
   model working.

## 6. Reset

Visitors' test decisions pile up. From a shell with the demo values (no real credential):

```bash
npm run demo:reset              # dry run: shows what would be deleted
npm run demo:reset -- --confirm
```

Reset removes the pending decisions too, so seed them again straight afterwards
(`docs/platform/demo-decisions.md`; it spends a little model credit):

```bash
npm run demo:seed-decisions -- --base-url https://<demo site> --confirm
```

Run both before the judging window opens and whenever the data looks cluttered. Scheduling it (a GitHub Action
with the demo token as a repository secret) is optional and not set up.
