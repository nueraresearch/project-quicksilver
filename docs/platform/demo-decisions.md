# Pre-made pending decisions for the demo

A judge who opens the demo should find decisions already waiting for approval. They are made by the
real planner, not typed in, so each has a genuine kernel explanation and fingerprint and can be
approved by the other demo person.

```
npm run demo:seed-decisions -- --base-url https://<demo site>            # dry run: lists the objectives
npm run demo:seed-decisions -- --base-url https://<demo site> --confirm  # plans them as Marcus Webb
```

- The objectives are in `apps/studio/seed/demo-objectives.ts`. Each says what it is meant to show.
- `--confirm` calls the model once per objective, so it spends model credit. Use `--only <id>` for one.
- It signs in with the public Marcus Webb demo token, so Sarah Chen can approve what it creates.
- It refuses any address that is not https (or localhost) and sends nothing in a dry run.
- It exits with code 2 if nothing came back awaiting approval.
- A model drafts each plan, so what comes back is reported, not promised. A refused plan is expected
  for `skip-inspection`; it shows the near-miss.
- `npm run demo:reset` clears decisions. Run this script again afterwards.
