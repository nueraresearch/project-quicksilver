# Judge access on the production app: an agent plans, the judge approves

The production app signs people in through single sign-on, so judges cannot use it without an account. This
gives them access that needs no account and no shared password, and that shows the point of the product: an
agent proposes, and a human authorizes.

- **One judge token.** A human principal with the `supervisor` role (for example `entity-sarah-chen`). The judge
  pastes it on `/sign-in`, under "Use an access token instead".
- **Decisions already waiting.** An **agent** entity (for example `entity-engineering-agent`, role
  `agent-worker`) asks the planner for a few plans, so the decisions record that agent as the requester. A requester
  can never approve its own request, but the judge is a different principal, so they can read why and approve.
- **No self-approval.** If the judge asks the chat for a plan themselves, they become the requester, and approving
  it is refused with the reason shown. That is the separation of duties, shown live.

## Set it up (in your own shell; never paste a token into a chat)

1. Make the two tokens. Each prints the token once, and a JSON entry that holds only its digest.

   ```bash
   npm run principal:token -- entity-sarah-chen supervisor
   npm run principal:token -- entity-engineering-agent --kind agent
   ```

   If `QUICKSILVER_TENANT_ID` is set on the site, set it in your shell first so the entries match it. Use entity ids
   that exist in the dataset: a decision records who approved it as a reference, and Sanity refuses a reference to
   a document that does not exist.

2. Add both entries to `QUICKSILVER_PRINCIPALS` on the production site (Vercel, Production), keeping any entries
   already there, and redeploy. Removing an entry and redeploying revokes that token.

3. Put the agent's token in a variable in your shell, then ask the planner for the decisions. The dry run shows
   what it would ask, and `--confirm` spends model credit (one plan per objective):

   ```powershell
   $env:QUICKSILVER_AGENT_TOKEN = "<the agent token>"
   npm run demo:seed-decisions -- --base-url https://project-quicksilver.vercel.app --token-env QUICKSILVER_AGENT_TOKEN
   npm run demo:seed-decisions -- --base-url https://project-quicksilver.vercel.app --token-env QUICKSILVER_AGENT_TOKEN --confirm
   ```

4. Check it in a private window: paste the judge token on `/sign-in`, open the decisions waiting for approval, read
   why, approve one, and download its audit trail.

## What a judge token can do

`supervisor` can approve, execute and roll back decisions, read the audit trail and review finance, and the site
holds real credentials, so treat a published token as access to the production app. Give the judge only what the
walkthrough needs, set a budget alert on the model account, and remove the entry when judging ends.
