# Judge access on the production app: an agent plans, the judge approves

The production app signs people in through single sign-on, so judges cannot use it without an account. This
gives them access that needs no account and no shared password, and that shows the point of the product: an
agent proposes, and a human authorizes.

- **One judge token.** A human principal with the `supervisor` role (for example `entity-sarah-chen`). The judge
  pastes it on `/sign-in`, under "Use an access token instead".
- **Decisions already waiting.** An **agent** entity (for example `entity-engineering-agent`, role
  `agent-worker`) asks the planner for a few plans, so the decisions record that agent as the requester. A requester
  can never approve its own request, but the judge is a different principal, so they can read why and approve.
- **No self-approval.** A requester can never approve its own request. A token with only `supervisor` cannot ask
  for a plan at all (the plan route needs `decision:propose`, which the app names in its 403), so the judge approves
  what the agent asked for. To let judges also ask for their own plan and see the refusal, add the `developer` role
  to their token; that also lets them write workflow and agent drafts, so the video is the safer place to show it.

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

   Then check the whole setup with one command. It tests both tokens, the tenant match, the waiting decisions, the
   audit export and the public dataset, and prints PASS, WARN or FAIL for each. It never prints a token. Add `--chat`
   to ask the chat one question (one model call):

   ```powershell
   $env:JUDGE_TOKEN = "<the judge token>"
   $env:AGENT_TOKEN = "<the agent token>"
   npm run demo:preflight -- --base-url https://project-quicksilver.vercel.app --judge-env JUDGE_TOKEN --agent-env AGENT_TOKEN --chat
   ```

   Run it before you record and again before you post. Each approval uses up one waiting decision, so seed more
   (the seeding command adds more each time it runs) if the preflight warns that few are left.

4. Check it in a private window: paste the judge token on `/sign-in`, open the decisions waiting for approval, read
   why, approve one, and download its audit trail.

## What a judge token can do

Tested in `apps/web/lib/agent-requester-flow.test.ts`: the `supervisor` role can approve, read decisions and the
audit trail, and ask the chat. The role also covers more than a walkthrough needs: execute (a simulation in this
build) and roll back decisions, redrive runs, review finance, approve memory and routing changes, and review and
publish drafts that someone else wrote. A published token is access to the production app, which holds real
credentials, so: set a budget alert on the model account, publish the token only where the rules require it, and
remove the entry and redeploy when judging ends. Built-in roles are all there is today: there is no role that can
approve a decision and nothing else.
