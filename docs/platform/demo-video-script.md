# Walkthrough video: script and shot list (about 3 minutes)

Record on the live app (https://project-quicksilver.vercel.app). Approving needs a second person: sign in as
the requester, then as an approver with a different account (two browser profiles make the switch quick).
Hide anything private before recording: other people's names, emails, and real company figures you do not
want public. Do a dry run first: a model drafts the plans, so what appears on screen can differ from this
script. Say what you see, not what is written here.

Screen recorder at 1080p, browser window about 1280 wide, zoom 110%, no other tabs, notifications off.
Captions on; many viewers watch muted.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Sign-in page | "Nuera Quicksilver lets AI agents propose company decisions, and makes a different human authorize them." |
| 0:15 | Sign in as the requester. Show the profile page or name in the header | "I'm signed in as the requester. Every action here is recorded under my name." |
| 0:25 | Open the chat. Ask: "What does our Operations Policy say about changing CNC controller parameters?" | "One chat. It reads the same company data in Sanity that the app shows." |
| 0:45 | Open **What I looked at** under the answer | "Every answer lists the sources it read, so I can check it rather than trust it." |
| 1:00 | Ask it to plan something; press **Create plan** on the offered card. Show the progress steps | "The assistant only offers. Nothing is created until I press the button, so the record shows a person asked." |
| 1:25 | Open the new decision. Show the **why** panel and, if one was refused, the near-miss | "The kernel checks the plan against policy. Here is why, and what would change the answer." |
| 1:50 | Try **Approve** as the requester (it refuses or is disabled, with the reason shown) | "I can't approve my own request, and neither can the agent that proposed it." |
| 2:05 | Sign in as the approver (second account or browser profile) | "A different person, with the approver role." |
| 2:15 | Open a waiting decision, read the why, approve | "They see the exact action and the policy version they are approving. If either changed, the approval would be refused." |
| 2:40 | Download the audit trail, show the digest | "Everything is recorded: who asked, what the agent proposed, who approved. It exports as JSON with a digest." |
| 2:55 | Back to the sign-in or overview page | "Agents propose, people authorize. Code and runbook are in the repo. Thanks." |

## Things not to say

- Do not say it was tested with real customers. Say what the data is: the app runs on our own company data in a private dataset; the public `demo` dataset is the synthetic copy.
- Do not say anything about cost, scale or uptime; none of it was measured.
- Do not promise a specific outcome from the model. Show what it returned.

## After recording

Upload the video, then put its link at the top of `docs/FOR-JUDGES.md` and in the dev.to post.
