# Walkthrough video: script and shot list (about 3 minutes)

Record against the demo site, signed in as the public demo people, after the demo dataset is seeded and
`npm run demo:seed-decisions` has been run. Nothing here is private. Do a dry run first: a model drafts the
plans, so what appears on screen can differ from this script. Say what you see, not what is written here.

Screen recorder at 1080p, browser window about 1280 wide, zoom 110%, no other tabs, notifications off.
Captions on; many viewers watch muted.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Sign-in page, "Try it as a judge" | "Nuera Quicksilver lets AI agents propose company decisions, and makes a different human authorize them. This is a public demo with synthetic data." |
| 0:15 | Press **Start as Marcus Webb**. Point at the bar: whose account, Switch button | "I'm Marcus, a developer. The bar always shows whose account this is." |
| 0:25 | Open the chat. Ask: "What does our Operations Policy say about changing CNC controller parameters?" | "One chat. It reads the same company data in Sanity that the app shows." |
| 0:45 | Open **What I looked at** under the answer | "Every answer lists the sources it read, so I can check it rather than trust it." |
| 1:00 | Ask it to plan something; press **Create plan** on the offered card. Show the progress steps | "The assistant only offers. Nothing is created until I press the button, so the record shows a person asked." |
| 1:25 | Open the new decision. Show the **why** panel and, if one was refused, the near-miss | "The kernel checks the plan against policy. Here is why, and what would change the answer." |
| 1:50 | Try **Approve** as Marcus (it refuses, with the reason shown) | "Marcus can't approve his own request, and neither can the agent that proposed it." |
| 2:05 | **Switch to Sarah Chen** | "Sarah is a supervisor." |
| 2:15 | Open a waiting decision, read the why, approve | "She sees the exact action and the policy version she is approving. If either changed, the approval would be refused." |
| 2:40 | Download the audit trail, show the digest | "Everything is recorded: who asked, what the agent proposed, who approved. It exports as JSON with a digest." |
| 2:55 | Back to the sign-in or overview page | "Agents propose, people authorize. Code and runbook are in the repo. Thanks." |

## Things not to say

- Do not say it was tested with real customers or live company data. The demo is synthetic.
- Do not say anything about cost, scale or uptime; none of it was measured.
- Do not promise a specific outcome from the model. Show what it returned.

## After recording

Upload the video, then put its link at the top of `docs/FOR-JUDGES.md` and in the dev.to post.
