# Nuera Quicksilver Platform

This area documents workflow authoring and execution, SDKs, triggers, identity
and secrets, observability, collaboration, and extensions. These are target
capabilities until connected to implementation and operational evidence. See the
[roadmap](../NUERA-QUICKSILVER-ROADMAP.md).

In the [product definition](../NUERA-QUICKSILVER-PRODUCT.md), this is the
**Foundation** layer. It includes the platform feature baseline (section 7) that
every operating mode depends on.

## Governance and authority

- [Identity and RBAC](identity-rbac.md)
- [Supervisor approval gate](supervisor-approval.md)
- [Authorization audit](authorization-audit.md)
- [Approved actions: email and signed webhook](approved-actions.md)
- [Tool registry](tool-registry.md)
- [Threat model: assets, trust boundaries, STRIDE and LLM threats, prioritized actions](threat-model.md)

## Agents and memory

- [Governed Nuera Quicksilver Agent catalog](agent-catalog.md)
- [Web governed-agent profiles, reviewed skills, routines and memory](agent-profiles.md)
- [Operator memory governance (M8 part 2)](operator-memory.md)
- [Chat assistant: what it can read and how it is kept to what you can see](chat-assistant.md)
- [Public web search and research boundary (P-024 foundation)](web-research.md)

## Workflows and runs

- [Workflow graph contract](workflow-graphs.md)
- [Workflow publication lifecycle (M8 foundation)](workflow-publication.md)
- [Durable workflow runs: queue, worker, dead letters](durable-runs.md)
- [Triggers: cron schedules and signed webhooks](triggers.md)
- [Governed task interface (M7): one intake path for API, MCP, webhook and CLI tasks](tasks.md)
- [Workflow monitoring dashboard](observability.md)

## Operating modes

- [Onboard (M5): shadow-mode playbook and the pilot](onboard-pilot.md)
- [Genesis (M5): the experiment and its evidence](genesis-run.md)
- [Genesis experiment research trajectories (P-031 foundation)](genesis-research.md)
- [Operate (M6): autonomy, reinvestment and bounded experiments](operate.md)
- [Experiment hosting](experiment-hosting.md)

## Kernel depth

- [Kernel depth (M7): policy lineage, supersession, scope nesting and the capability graph](kernel-depth.md)
- [What-if engine (M7): Monte Carlo cash, experiment odds, stress scenarios and shadow-log counterfactuals](what-if.md)
- [Department economics proposals (P-071 foundation)](department-economics.md)

## Hosting and runtime

- [Hosted runtime: host process, management API, secrets vault, logs and metrics](hosted-runtime.md)
- [Render operational evidence (2026-10-05/06)](render-operational-evidence-2026-10-05.md)
- [Always-on hosting](always-on-hosting.md)
- [Azure: the host and the services behind it](azure-deploy.md)
- [Media handling in the hosted runtime](media.md)

## Identity and access

- [SSO setup: browser sign-in and sessions](sso-setup.md)
- [Judge access to production](judge-access-production.md)

## Content and data

- [Dedicated Sanity project setup](sanity-isolation.md)
- [Demo decisions dataset](demo-decisions.md)

## SDKs

- [TypeScript SDK foundation](sdk-typescript.md)
- [Python SDK and CLI foundation](sdk-python.md)
- [Go SDK foundation](sdk-go.md)

## Release gates and acceptance

- [Parity tests: the pass/fail requirements for the 0.9.0 and 1.0.0 gates](parity-tests.md)
- [Parity build: turning parity items into changes](parity-build.md)
- [v1 acceptance matrix](V1-ACCEPTANCE.md)
- [v1 credential prerequisites](v1-credential-prerequisites.md)
- [M7 release evidence](m7-release-evidence.md)

## Demo and judging

- [Demo walkthrough for judges](judge-demo.md)
- [Demo video script](demo-video-script.md)
- [Live email on Render: the first real approved action](render-live-email.md)

## References outside this directory

- [API contract and OpenAPI](../api/api-contract.md)
- [Demo pre-checks and post-checks](../DEMO-SCRIPT.md)
- [Judge guide](../FOR-JUDGES.md)