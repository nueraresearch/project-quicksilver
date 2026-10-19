# Native local operation

## Target and boundaries

The target is a Quicksilver-owned, self-hosted experience: no mandatory SaaS
account, hosted model key, or paid API for features that can run locally. Setup
should provision a local inference runtime and download a suitable model, with
explicit disk, memory, network, license and checksum checks. That automated
installation is a target, not an implemented capability of this change.

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
| 1. Native storage | Replace the console's direct Sanity query/mutation coupling with typed repository contracts and a durable local implementation. Migrate policy snapshots, documents, sessions, profiles and audit data without changing kernel decisions. Keep Sanity optional. | Console, approvals, memory, workflows and operator organization work after restart with all Sanity variables unset; unauthorized and cross-tenant access still refuse. |
| 2. Local identity | Add first-owner enrollment and local authentication using standard security primitives; generate local signing/encryption keys and support rotation, recovery and revocation. Keep OIDC optional. | No external identity account required; remote unauthenticated enrollment, self-grants and invalid sessions refuse. |
| 3. Managed inference | Detect hardware, provision a pinned local runtime, verify model artifacts, support interrupted downloads and expose model health. Preserve structured-output validation. | Fresh install downloads and runs a local model without a hosted model key; insufficient resources, invalid artifacts and unavailable inference produce actionable refusals. |
| 4. Standard communication | Add SMTP submission, then STARTTLS, IMAP inbox polling and MIME/thread handling. Bridge the same transport into operator channels and drafted communications without using inbound email identity as approval authority. | Approved mail is submitted through the dedicated mailbox without Resend; receiving mail needs no vendor webhook; failed delivery is never reported as successful. |
| 5. Local services and packaging | Unify installation, migrations, backups, search/indexing, file/media handling, monitoring and schedules into the local lifecycle. Keep cloud hosting optional. | An isolated installation can complete representative workflows without SaaS keys; backup/restore preserves decisions and grants. |
| 6. Phone transport | Add a governed SIP/PBX adapter for voice and supported messaging, or a user-owned cellular modem adapter. Retain vendor APIs only as optional transports. | Supported hardware/service can send and receive with approval and audit controls; unsupported number capabilities refuse clearly. |

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