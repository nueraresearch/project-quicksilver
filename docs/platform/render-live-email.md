# Render host: the first real approved email

Goal: one email that an agent proposed, a human read and approved, and Resend delivered, with the audit
record to show for it. Until this has happened, the repository says no real email has been sent by this code.

The two files in `deploy/render/` are templates. Copy them into Render **secret files** and edit them there:

- `quicksilver.host.render.json` is the host config (tenant `brodi`, Postgres, the vault on the `/data` disk).
  It has no schedules and no workflows, so nothing runs on its own and no model is called.
- `actions.render.json` turns on the `notification.send` tool and names the sender and the allowed recipient.
  Replace the placeholder recipient with the address of your Resend account.

## Why these settings

- **Sender.** `onboarding@resend.dev` is Resend's shared test sender. It can only deliver to the email address of
  the Resend account itself, so that address is the recipient. To send to anyone else, verify a domain in Resend and
  change `from`.
- **Recipient allow-list.** The tool refuses any address not on the list, so an agent cannot email a customer.
- **Who may approve.** On the host, approving needs `intent:provide`, which the built-in `intent-provider` role holds.
  An agent can propose (the `agent-worker` role) and can never approve. The approver must not be the proposer.
- **Persistence.** Proposals are kept in files under `QUICKSILVER_ACTIONS_DIR`. Point it at the disk (`/data/actions`),
  or they are lost on a restart.
- **The vault key.** Once the host has started, changing `QUICKSILVER_VAULT_KEY` makes it refuse to start ("The vault
  master key does not match this vault"). Generate it once and keep a private copy.

## Environment variables on the Render service

`deploy/render.yaml` now declares all of these. The ones marked `sync: false` (principals, vault key, authorization key and the Resend key) are blank until you enter them in the dashboard; the rest are set for you.

| Variable | Value |
|---|---|
| `QUICKSILVER_TENANT_ID` | `brodi` (the blueprint now sets this) |
| `QUICKSILVER_PRINCIPALS` | an array of two entries made with `npm run principal:token`: the founder (`entity-founder`, role `intent-provider`, human) and the agent (`entity-engineering-agent`, `--kind agent`). Set `QUICKSILVER_TENANT_ID=brodi` in your shell first so the entries carry that tenant. Make new tokens; do not reuse any that have been pasted anywhere. |
| `QUICKSILVER_AUTHORIZATION_KEY` | a random string of at least 32 characters. Without it every approval is refused with 503. |
| `QUICKSILVER_ACTIONS_CONFIG` | `/etc/secrets/actions.json` |
| `QUICKSILVER_ACTIONS_DIR` | `/data/actions` |
| `QUICKSILVER_EMAIL_API_KEY` | your Resend API key. Enter it in the Render dashboard only. |

With either the `email` block or the key missing, `notification.send` stays a dry run and the host logs that.
A live tool is announced in the start-up log: `notification.send is LIVE`.

## Do it

1. Add the two secret files and the variables above, then deploy (the blueprint has `autoDeploy: false`).
2. Check the log shows `notification.send is LIVE`, and `GET /healthz` answers `{"status":"ok"}`.
3. The agent proposes the email (`POST /api/actions/proposals` with `toolId`, `input: { to, subject, text }`, a `reason`
   and 1 to 10 `evidence` references). This records only; nothing is sent.
4. Try to approve it with the agent token. It must be refused (403).
5. Approve it with the founder token (`POST /api/actions/proposals/<id>/approve`). Approval runs the action at once.
6. Confirm the email arrived and that Resend's log shows the send. Keep the proposal record
   (`GET /api/actions/proposals/<id>`) as the evidence.
7. Approving the same proposal again is refused (409).

Tested locally in dry-run mode (no key, nothing sent): propose, refused approval by the agent, approval by the human,
refusal of a second approval. Not tested against Resend or against the Postgres store.

## After the first real send

Only then, change the "not proven" lists that say no real email has been sent, and say exactly what happened: one
email to your own address through Resend's test sender, approved by one human, proposed by one agent entity.
