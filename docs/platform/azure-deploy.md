# Azure: the host and the services behind it

The always-on host runs on Azure (decision recorded in [always-on hosting](always-on-hosting.md)).
This page has the deploy template, the steps, and a map of which other Azure services could power
the pieces that are not set up yet. Nothing here has been deployed: the template was compiled with
the Bicep compiler (v0.47.16) but never applied to a subscription, so expect to fix small things on the first
run.

## What the template creates

`deploy/azure/main.bicep`, one resource group:

| Resource | Used for |
|---|---|
| App Service plan + Web App for Containers | Runs the image built from `deploy/Dockerfile.host`; Always On, health check `/healthz`, HTTPS only |
| Azure Database for PostgreSQL Flexible Server | The managed run store (`DATABASE_URL`), 7-day backups |
| Azure Container Registry | The host image; the web app pulls it as itself (managed identity, no registry password) |
| Key Vault (RBAC) | Every secret. App settings are Key Vault references; the template contains no secret value |
| Storage account with two Azure Files shares | `/data` (vault file, intent graphs, ledger) and `/config` (the host config JSON) |
| Log Analytics + Application Insights | Logs and the connection string the host can export to |

## Steps (yours; they create billable resources)

1. `az group create --name quicksilver-rg --location <region>`
2. `az deployment group create --resource-group quicksilver-rg --template-file deploy/azure/main.bicep --parameters postgresAdminPassword=<letters-and-digits, 20+> sanityProjectId=<id> sanityContextMcpUrl=<url> azureOpenAiResourceName=<name>`
   Do not paste the password into chat or a ticket. The outputs name the registry, vault and host URL.
3. Put the secrets in Key Vault (you need the *Key Vault Secrets Officer* role on the vault):
   `quicksilver-vault-key` (from `npm run host -- vault keygen`), `quicksilver-principals`,
   `sanity-context-token`, `sanity-write-token`, `azure-openai-api-key`. The host will not start until they
   exist: an unresolved reference stays as literal text.
4. Upload your host config (start from `deploy/quicksilver.host.example.json`, with
   `http.host: "0.0.0.0"`, `http.port: 8787`, `store.kind: "postgres"`) to the `qs-config` share as
   `quicksilver.host.json`. It holds no secrets.
5. Build and deploy the image: run the **Deploy host to Azure** workflow (manual), or
   `az acr build --registry <registry> --image quicksilver-host:<tag> --file deploy/Dockerfile.host .` and
   `az webapp config container set`. For the workflow, create an Entra app registration with a federated
   credential for this repository and set the repository variables listed at the top of
   `.github/workflows/azure-host-deploy.yml`. No client secret is stored.
6. Check `https://<host>/healthz` and `/readyz`, then `GET /api/whoami` with a token.

## Limits you should know before relying on it

- The database accepts connections from Azure services over TLS; it is not on a private network. Move the
  host and database into a VNet with private endpoints before real customer data.
- One instance, one tenant, no high availability, no autoscale. That matches the host today.
- Azure Files is network storage: fine for the vault file and ledger at this size, not for heavy writes.
- Payment webhooks need the public host URL, so the Genesis run still waits on the entity decision and
  payment accounts, not on this template.
- The web app stays on Vercel. Moving it to Azure is possible but is not needed for anything here.

## What else Azure could power

Ordered by how much it closes. None of these is built; "needs" is what only the account owner can supply.

| Piece | Azure service | Closes | State today | Needs |
|---|---|---|---|---|
| Models | Azure OpenAI / Foundry | planner, reviewer, query, WAES (P-017, P-045) | Supported: `QUICKSILVER_MODEL_MODE=azure`, `AZURE_API_KEY`, `AZURE_RESOURCE_NAME` | Deployed models, key in Key Vault |
| Sign-in | Microsoft Entra ID (or Entra External ID) | P-108 | OIDC code is generic; Google is the live provider | An app registration and issuer URL |
| Observability and alerts | Application Insights, Azure Monitor action groups | P-114 (host traces, alert delivery) | Template creates App Insights; the host does not export to it yet | Code: export spans; alert rule and recipients |
| Email | Azure Communication Services Email | P-022, P-095 | Resend adapter only, dry run | New adapter; a verified sender domain |
| SMS and voice | Azure Communication Services | P-022 | Twilio adapter only | New adapter; a phone number |
| Media | Azure AI Speech, Vision, Document Intelligence; Azure OpenAI image models | P-025 | Contract and policy exist, no provider | A `MediaProvider` per kind |
| Content safety | Azure AI Content Safety | moderation in P-025, customer-facing text | In-repo moderation only | A client in the media path |
| Experiment pages | Storage static website or Static Web Apps | P-026 | Directory adapter only | A deploy adapter |
| Secrets | Key Vault | P-110 (A-6) | In the template | Secrets entered by you |
| Deploy | GitHub Actions with federated credentials | P-014 | Manual workflow in this change | Entra app registration |

Sanity stays the content lake and the Context MCP endpoints stay Sanity's: nothing above replaces them.

## Cost

Nothing is created until you run step 2. As a rough guide the template's defaults are one B1 App Service plan,
one Burstable PostgreSQL server (32 GB), a Basic registry, a Standard_LRS storage account, a Key Vault and
Application Insights. Check the Azure pricing calculator for your region before deploying; this page does not
quote prices because they change.
