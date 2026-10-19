# Native local operation

## Target and boundaries

The migration proceeds from the current Sanity-backed application, through a
customized Strapi chassis, to the Quicksilver CMS Module as the product-owned
backend. Strapi is an implementation chassis, not a reason to couple
Quicksilver's domain logic to generic CMS behavior. Sanity and standalone Strapi
may remain optional adapters or migration sources after cutover, but neither may
be a required external service for the built-in product.

The target is a Quicksilver-owned, self-hosted experience: no mandatory CMS
account, hosted model key, or paid API for features that can run locally. A clean
install should provision the supported local database, application and inference
runtime, then download a compatible model with explicit disk, memory, network,
license and checksum checks. That automated installation is a target, not an
implemented capability of this scaffold. Email, phone, payment and public web
features may still require the corresponding real-world service, carrier,
device or network; these must remain optional for unrelated core workflows.

## Provider Feature Parity and Cutover

Do not switch the default backend merely because Strapi schemas exist or because
the initial ontology queries work. The native Quicksilver backend must **meet or
exceed every feature available through the current Sanity implementation and
each supported optional provider**. Keep a versioned provider-by-provider
capability matrix; for every provider feature, record native behavior, evidence,
known gaps and whether the feature depends on an external account or service.
Features may not silently disappear when changing providers. A richer native
alternative is acceptable only when it preserves the old workflow's guarantees
and has documented acceptance coverage.

Parity evidence must cover, at minimum:

- All schemas, fields, relations, validation, drafts/publication, query filters,
	sorting, pagination, API response contracts, import/export and migration.
- All admin/editor workflows, preview, seeding, content lifecycle, backups,
	restore, search and agent-context retrieval that each provider currently
	supplies or that Quicksilver promises as a core feature.
- Decisions, policy snapshots, approvals, audit history, sessions, profiles,
	evaluations and workflow execution, including human separation of duties and
	fail-closed behavior.
- Tenant isolation, same-tenant relation enforcement, unauthorized-access
	refusals, audit durability, replay/idempotency and provider failure behavior.
- A repeatable data migration rehearsal with counts and content digests,
	restart/restore checks, documented rollback, and no lost or duplicated writes.
- The full credential-free regression/build gates with Sanity and external
	Strapi settings unset, plus representative workflow acceptance tests and owner
	sign-off on every difference.

Before cutover, use read comparisons or a disposable migration dataset. Never
perform uncoordinated dual writes: they create split-brain state. Cut over one
tenant/deployment at a time, select one authoritative writer, freeze or drain
writes for final synchronization, verify parity, and retain a tested rollback
path. After cutover, optional provider adapters are read-only by default; any
write-back mode needs explicit conflict resolution and audit semantics.

**Default-backend removal gate:** on a clean install with all Sanity and
external-Strapi settings unset, every core feature must work against the
Quicksilver-owned backend. Only after the complete feature matrix passes may
Sanity cease to be required. The native module must not require an externally
provisioned Strapi service or project either.

"Native" means Quicksilver owns its data, workflows, administration and UI. It
does not mean rewriting TLS, cryptography, databases or model inference engines.
Audited libraries and bundled local runtimes are different from mandatory
credentialed services. Existing integrations stay optional; missing credentials
must never grant authority or silently switch a configured live action to another
provider.

The NQC Kernel remains the authority. Human approvals, tenant isolation, durable
audit records and fail-closed execution apply equally to local deployments.
Local credentials can be generated during setup; no external identity account
should be required for a single-owner installation.

## Delivery Order

These are proposed implementation stages, not claims of completed migration.

| Stage | Work | Acceptance check |
|---|---|---|
| 1. Strapi chassis and parity inventory | Add the local Quicksilver Strapi plugin chassis and map current Sanity schemas, APIs, workflows and data to the ontology. Keep Sanity active until parity is evidenced. | Versioned capability matrix covers every provider feature, with migration fixtures and documented differences. |
| 2. Quicksilver-owned default backend | Complete local repositories, admin/API experience, authorization, audit, migrations, backups and recovery. Make both CMS integrations optional. | Clean install works with Sanity and external Strapi settings unset; existing capability and refusal suites pass against the new backend. |
| 3. Parity rehearsal and cutover | Rehearse import, compare records and behavior, test rollback, then switch one deployment at a time with one authoritative writer. | Full feature matrix passes, data divergence is resolved, rollback is rehearsed, and owner signs off before changing defaults. |
| 4. Local identity | Add first-owner enrollment and local authentication using standard security primitives; generate local signing/encryption keys and support rotation, recovery and revocation. Keep OIDC optional. | No external identity account required; remote unauthenticated enrollment, self-grants and invalid sessions refuse. |
| 5. Managed inference | Detect hardware, provision a pinned local runtime, verify model artifacts, support interrupted downloads and expose model health. Preserve structured-output validation. | Fresh install downloads and runs a local model without a hosted model key; insufficient resources, invalid artifacts and unavailable inference produce actionable refusals. |
| 6. Standard communication | Add SMTP submission, then STARTTLS, IMAP inbox polling and MIME/thread handling. Bridge the same transport into operator channels and drafted communications without using inbound email identity as approval authority. | Approved mail is submitted through a dedicated mailbox; receiving mail works without a vendor webhook; failed delivery is never reported as successful. |
| 7. Local services and packaging | Unify installation, migrations, backups, search/indexing, file/media handling, monitoring and schedules into the local lifecycle. Keep hosted services optional. | Isolated installation completes representative workflows without SaaS keys; backup/restore preserves decisions and grants. |
| 8. Phone transport | Add a governed SIP/PBX adapter for voice and supported messaging, or a user-owned cellular modem adapter. Retain vendor APIs only as optional transports. | Supported hardware/service can send and receive with approval and audit controls; unsupported number capabilities refuse clearly. |

A phone number is an address, not a transport. Ordinary cellular and PSTN access
still requires a carrier, SIP service/PBX, or modem and SIM. Not every VoIP number
supports SMS, and SIP voice support does not imply SMS support. Software cannot
remove those network requirements. Payments, domains and third-party account
actions similarly require the relevant external account when explicitly used;
they must not become prerequisites for unrelated local features. Public web
research still requires a network/source even without a paid search API.

## Implemented First Increment: SMTP

The host's governed `notification.send` action now supports a built-in SMTP
transport using Node's TLS and stream APIs, with no additional npm dependency
or Resend account. This is outbound operational notification delivery only, not
a complete email channel or a finished local installation.

Use `deploy/actions/actions.smtp.example.json` as the policy template. Set
`QUICKSILVER_ACTIONS_CONFIG` to the configured policy file and provide
`QUICKSILVER_SMTP_USERNAME` and `QUICKSILVER_SMTP_PASSWORD` through the existing
secret environment. The configured `from` address must be permitted by the mail
server; restrict `recipients` to intended internal recipients. Existing host
identity, action authorization-key and human-approval prerequisites still apply.
Never store actual mailbox passwords in tracked policy files.

This increment supports **implicit TLS**, normally port **465**, and SMTP
`AUTH PLAIN` only inside verified TLS. It does not support port-587 STARTTLS,
OAuth-only mail accounts, unauthenticated local relays, attachments, IMAP, POP3,
inbound email or operator-channel SMTP wiring. Unsupported configurations refuse
submission; there is no plaintext downgrade or fallback to Resend. Existing
email policies without `provider` retain Resend behavior for compatibility.
Invalid email settings leave the existing host action in explicit dry-run mode;
no real delivery is then claimed.

Delivery keeps the recipient allowlist, exact-call human approval and policy
fingerprint. Changing the SMTP server, account, sender or recipient policy makes
pending approvals stale. Certificate validation remains enabled; subjects are
MIME encoded and bodies are base64 encoded to prevent protocol injection. The
transport has a bounded response size and total timeout, and errors do not echo
server text or mailbox credentials.

A successful result means the SMTP server accepted the message, not that it
arrived in an inbox. SMTP has no general idempotency guarantee: the stable
Message-ID is not server-side deduplication. Repeated approvals are refused by
the action service, but a lost connection after submission is ambiguous; inspect
the mailbox before a new proposal or retry. Credential-free scripted-stream
tests cover the approval path and transport refusals. No real mailbox submission
or live interoperability has been proven by these tests.

See [current status](../CURRENT-STATUS.md) for the existing operational gaps.