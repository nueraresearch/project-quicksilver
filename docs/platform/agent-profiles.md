# Web governed-agent profiles

The web runtime resolves a process-owned profile for each governed worker before dispatch. Built-in profiles cover the planner, reviewer, query agent, and all seven business specialists. Each profile has its own `agent:<agent-id>` memory domain; callers cannot choose or override that domain.

## Optional profile file

Set the server-only `QUICKSILVER_AGENT_PROFILES_FILE` to a JSON file. Relative paths resolve from the web process working directory. The file is versioned, capped at 64 KiB, and rejects unknown fields, duplicate identities, and identities outside the built-in web-agent roster. A profile entry overrides the built-in version and adds resource references; the memory domain is always derived from its agent identity.

```json
{
  "schemaVersion": 1,
  "profiles": [
    {
      "agentId": "nuera-quicksilver:planner",
      "version": 1,
      "skillIds": ["planning-evidence"],
      "routineIds": ["weekly-review"],
      "contextFiles": ["PROJECT.md"]
    },
    {
      "agentId": "nuera-quicksilver:reviewer",
      "version": 1,
      "skillIds": ["independent-review"]
    }
  ]
}
```

A configured but missing or invalid resource fails closed: the affected web-agent dispatch does not proceed with a silently incomplete profile. The validated registry and configured resource roots are cached for the process lifetime, so profile-file or root-setting changes require a web-process restart. Active resource file contents are reloaded during profile resolution.

## Resource sources and limits

- **Skills:** `QUICKSILVER_SKILLS_DIR`, or `~/.quicksilver/skills` by default. The web profile loader accepts only valid skills in the library's `active/<name>/SKILL.md` store and includes the skill text plus self-contained sidecar files from the reviewed bundle. Pending, revoked, and project-local skills are not loaded as reviewed resources. The active tree must remain under its configured library root; skill directories, instruction files, and sidecars cannot be symlinks. Traversal is bounded to 64 files and 256 entries, and the complete skill must fit the agent-profile resource limit (8,000 characters). Oversized or unsafe bundles are rejected, not truncated.
- **Routines:** `QUICKSILVER_ROUTINES_DIR`, or `~/.quicksilver/routines` by default. The loader reads only owner-managed `active/<id>.md` files, with simple routine IDs, an 8,000-character limit, and the same traversal/symlink boundary used for project context. There is not yet a routine authoring/review UI; only put human-reviewed files in `active/`.
- **Project context:** `QUICKSILVER_PROJECT_CONTEXT_ROOT`, or the web process working directory by default. `contextFiles` must be relative POSIX-style paths. Traversal, absolute paths, symlink escapes, non-files, and files over 8,000 characters are refused.

Resolved profile and recalled-memory text is explicitly formatted as **untrusted reference data**, never instructions, approvals, policy, or evidence by itself. The planner, reviewer, query, and business-specialist adapters now carry this context into their model prompts; deterministic kernel authorization remains authoritative.

## Optional web-agent memory

Set `QUICKSILVER_AGENT_MEMORY_DIR` to opt in to web-agent recall and governed writes. The file store is partitioned as `<root>/<encoded-tenant>/<encoded-agent>/memory.json`; `QUICKSILVER_TENANT_ID` supplies the **deployment-wide** tenant key and defaults to `default` for single-tenant development. Every worker receives only its own profile memory domain. If the setting is absent, web agents still receive their profile resources but have no persistent memory store. The current web resolver does not derive a tenant from each authenticated request, so do not enable this file store for multiple tenants sharing one web process until a trusted per-request tenant identity and shared-store adapter are added.

`FileMemoryStore` is a single-writer-process-per-file implementation, not a multi-host coordination layer. Keep the setting unset on multi-instance/serverless deployments until a shared-store adapter is configured. Store the root on an appropriately protected durable volume; the file store itself does not encrypt the memory contents. Agent memory is separate from human product-memory files.

## Evidence and remaining operational work

Automated coverage is in `apps/web/lib/agent-profiles.test.ts` and `packages/agent/src/profiles.test.ts`. These tests cover profile identity, active-only skill loading with sidecar bounds, route/adaptor wiring, routine/context paths, advisory prompt formatting, and deployment-tenant/agent memory partitioning. A live model run with production-owned profile resources and a multi-instance-safe persistent store remain deployment evidence, not claims made by this code change.
