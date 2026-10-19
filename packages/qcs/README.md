# Quicksilver Communications Substrate

QCS is a portable TypeScript communications scaffold for Quicksilver, Sameday
STRO, Nuera RDL, and other hosts. It has **no runtime npm dependencies** and
requires Node.js 22.6+ under this repository's TypeScript execution model.
It is a private workspace package, not a published or stable external SDK.

## Boundaries

```text
Agent proposes / authenticated external connector receives
                         |
Host authenticates principal, tenant and ingress
                         |
Kernel policy / human approval -> signed exact-action grant
                         |
KernelQcsClient (injected port; no transport dependencies)
                         |
QcsImpl -> injected authority -> audit -> channel route -> adapter
                         |
                    tenant-scoped events
```

`packages/kernel/src/comms/qcs_client.ts` is a thin structural client. It does
not import QCS, a provider SDK or a network transport, and grants no authority.
`packages/host/src/qcs.ts` contains the Quicksilver-specific grant verifier and
the existing native SMTP transport bridge. Other applications supply their own
authority and audit implementations without importing Quicksilver's kernel.

Agent `roles` and `permissions` are descriptive identity data. Registering an
identity never makes those fields an authorization source. Registration,
identity reads, subscription, ingestion and effects all go through an injected
`QcsAuthority`. No authority means refusal. Authorities must verify a trusted
principal/tenant, policy and any required human approval, bind the exact intent,
and atomically consume authorization before returning. Never use an agent-written
manifest or an `allow: true` callback as production authority.

## Package Map

| Location | Responsibility |
|---|---|
| `src/interfaces/types.ts` | JSON-only identities, bindings, messages, events, context, authority, audit and adapter contracts |
| `src/interfaces/qcs_api.ts` | Public `QCS` interface |
| `src/core/config.ts` | Structured configuration, JSON validation, canonical intent fingerprints |
| `src/core/identity.ts` | Tenant-scoped identity registry, binding validation and defensive copies |
| `src/core/router.ts` | `QcsImpl`: route resolution and authority/audit boundaries |
| `src/core/events.ts` | Tenant-scoped subscription, delivery and unsubscribe |
| `src/channels/` | Voice, SMS, email, signal and IoT facades |
| `src/adapters/` | Dummy, SMTP transport port, and explicit unavailable provider scaffolds |
| `tests/qcs.test.ts` | Core, router, channel and event tests |

`signal` means radio/mesh/BLE/LoRa-style transport, **not** the Signal messenger.
There is no radio implementation or device control in this scaffold.

## API and Configuration

Construct `QcsImpl` with `authority`, a required async `audit` sink, `adapters`,
and a `routes` object mapping channel types to adapter IDs. Routes must point
to adapters that declare support for that channel. No automatic vendor fallback
or role-derived routing is performed; preferences such as SMS for cleaners and
email for owners must be explicitly resolved by the host before approval.

All public operations accept a trusted `QcsContext` containing `tenant_id` and
`principal_id`, plus the host's authorization evidence. A web endpoint must
derive context from authentication, never copy it directly from a request body.

| Method | Behavior |
|---|---|
| `registerAgent(identity, context)` | Authorized registration/update in the current tenant |
| `getAgentIdentity(agentId, context)` | Authorized, tenant-scoped defensive identity copy |
| `sendMessage(request, context)` | Explicit SMS/email/signal/IoT route; exactly one agent or external destination |
| `placeCall(request, context)` | Voice route; unsupported transports refuse |
| `emitIoTCommand(request, context)` | IoT route; unsupported transports refuse |
| `subscribeToEvents(handler, context)` | Authorized subscription returning an unsubscribe function |
| `receiveEvent(request, context)` | Authorized, normalized external event with ISO timestamp and channel |
| `broadcastMessage({ messages }, contexts)` | Up to 100 sequential sends, each with its own authorization context |

Broadcasts are **not atomic**. A later refusal does not undo earlier sends.
An error must not trigger blind replay of the whole broadcast.

The resolved intent fingerprint includes the operation, tenant, authenticated
principal, request payload, channel, source/destination addresses and adapter ID.
The host bridge requires capability `qcs.<operation>` in a kernel-signed grant,
plus independently loaded run, node, workflow, approval and evidence bindings.
Its binding resolver is trusted host code: it must load current authority from
the authenticated run/policy store, not reflect values supplied by the grant.
The bridge verifies existing grants; it never issues grants or manufactures
human approval. Endpoint/provider configuration must also be represented in the
host's approved policy/workflow snapshot before live deployment.

Audit records contain status, identifiers, timestamps and action digests, not
message bodies, credentials, model reasoning or provider errors. An audit write
must complete before an effect. Failure to record completion after a send is
reported as ambiguous, not as proof that nothing happened.

## Adapter Status

- `DummyAdapter` records copies in memory and always returns `simulated`, never
  delivery success. It supports every channel for tests.
- `SmtpAdapter` is a portable email adapter with an injected submission function.
  It accepts text plus `metadata.subject`, or `{ subject, text }` payloads.
  `createSmtpQcsAdapter` in the host connects it to native verified-TLS SMTP;
  see [native SMTP setup](../../docs/platform/native-local.md).
- `TwilioAdapter` and `SendgridAdapter` are explicit unavailable placeholders.
  They do not require credentials, contact providers, or claim successful sends.
- Use `UnavailableAdapter` for unimplemented radio, modem, SIP or IoT backends.

An `accepted` SMTP result means accepted by the mail server, not delivered to an
inbox. Stable Message-IDs are not an exactly-once guarantee.

## Limits and Next Work

This is scaffolding, **not a deployed communications service**. Existing host
actions and operator channels have not been migrated to QCS. Host startup does
not automatically instantiate it, and no new public route has been exposed.
The web console, Sameday STRO and Nuera RDL have not been wired to it.

Identity storage, subscriptions and host replay protection are process-local.
Production needs durable tenant-scoped identities and atomic grant consumption
across restarts/replicas, an outbox/inbox with idempotency and delivery receipts,
event retention/replay and bounded asynchronous subscriber delivery. Subscribers
currently run in process and can delay completion; events are not retained.
Inbound events stay external observations, not proof of human approval or agent
identity. Before accepting real webhooks, authenticate signatures, check replay,
bind ingress to the proper tenant, and sanitize untrusted content in the host.

Live adapters also need configured recipient/device allowlists, destination
validation appropriate to each protocol, budgets, consent/opt-out requirements,
rate limits and provider configuration bound to policy. Host-side policy must
enforce these; QCS routing alone is not a communications security policy.
No real call, SMS, radio transmission, IoT command or QCS email delivery is
operationally proven here. SMTP inbox polling, SIP/modem integration, preference
routing, an interaction graph and a Python API remain future work.

## Verification

From the repository root:

```bash
npm run qcs:test
node --experimental-strip-types --no-warnings --test packages/host/src/tool-adapters.test.ts
npm run verify
npm run build --workspace=@quicksilver/web
```

The host adapter suite includes kernel-client -> QCS -> dummy integration with
real signed test grants, including refusal for missing, changed, expired,
cross-tenant and concurrently replayed authorization. These are local,
credential-free tests, not live-provider evidence.