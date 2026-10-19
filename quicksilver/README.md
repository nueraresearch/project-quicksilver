# Quicksilver CMS Module

This directory is the Quicksilver-specific backend module intended to become a
customized/forked Strapi backend during the Sanity-to-Quicksilver migration.
Strapi is an implementation chassis, not the product's source of authority. Quicksilver
ontology, queries, contradiction and decision lifecycle, and deterministic
context logic live under this directory.

## Layout

- `ontology/`: ten Strapi collection-type schemas, each carrying `tenantId`.
- `query/`: tenant-scoped query contracts; implementations are TODOs.
- `engine/`: contradiction analysis and decision lifecycle placeholders.
- `context/`: deterministic tenant context placeholder.
- `utils/`: shared tenant-scoped types.
- `server/src/`: Strapi plugin entrypoint and content-type registry.
- `strapi.plugins.example.ts`: host configuration fragment to enable this plugin.

## Registration and Current Host

The plugin exports schemas through Strapi's `contentTypes` plugin property;
their UIDs are `plugin::quicksilver.<singularName>`. Merge the `quicksilver`
entry from `strapi.plugins.example.ts` into a Strapi host's `config/plugins.ts`,
adjusting the `resolve` path relative to that host.

Project Quicksilver currently has a Sanity web/Studio host and does not yet
include a Strapi host or Strapi dependency. Therefore this scaffold is **not
active or runtime-registered in the current application**. Adding a host and
activating this plugin is a migration milestone, not something this isolated
scaffold can claim to have completed.

The eventual product should start with the Quicksilver-owned backend without a
Sanity project, Sanity credentials, external Strapi project, or external CMS
service. Sanity and standalone Strapi connectivity may remain optional adapters
for migration or deployments that choose them. See
[`docs/platform/native-local.md`](../docs/platform/native-local.md) for the
feature-parity gate and cutover rules.

## Tenant Isolation

Every content type includes a required, non-configurable string `tenantId`.
Relations are only valid between records with the same tenant. Strapi's normal
relation schema does not provide composite tenant foreign keys; the future
repository/query layer and authorization middleware must enforce this rule and
derive tenant identity from an authenticated principal, never request input.
The field alone is not an isolation boundary.

All query and engine functions currently throw TODO errors. No contradiction
detection, context assembly, authorization, approval, execution or rollback is
implemented. Approval authority remains with the NQC Kernel.
