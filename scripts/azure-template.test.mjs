import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const bicep = await readFile(new URL('../deploy/azure/main.bicep', import.meta.url), 'utf8')
const render = await readFile(new URL('../deploy/render.yaml', import.meta.url), 'utf8')
const workflow = await readFile(new URL('../.github/workflows/azure-host-deploy.yml', import.meta.url), 'utf8')

test('the Azure template sets every environment variable the Render blueprint sets', () => {
  const renderVars = [...render.matchAll(/- key: ([A-Z_]+)/g)].map((m) => m[1])
  assert.ok(renderVars.length >= 10)
  // SANITY_AUTH_TOKEN is the legacy combined token: the Azure path never needs it.
  const missing = renderVars.filter((name) => name !== 'SANITY_AUTH_TOKEN' && !bicep.includes(`'${name}'`))
  assert.deepEqual(missing, [], 'add these to deploy/azure/main.bicep or say why they are not needed')
  assert.ok(!bicep.includes("'SANITY_AUTH_TOKEN'"))
})

test('every secret is a Key Vault reference, and no secret value is written in the template', () => {
  for (const name of ['DATABASE_URL', 'QUICKSILVER_VAULT_KEY', 'QUICKSILVER_PRINCIPALS', 'SANITY_CONTEXT_TOKEN', 'SANITY_WRITE_TOKEN', 'AZURE_API_KEY']) {
    assert.match(bicep, new RegExp(`name: '${name}', value: '\\$\\{kvRef\\}`), `${name} should be read from Key Vault`)
  }
  assert.match(bicep, /@secure\(\)\s*@minLength\(20\)\s*param postgresAdminPassword string/)
  assert.doesNotMatch(bicep, /sk-[A-Za-z0-9]{20,}|AccountKey=|-----BEGIN/)
})

test('the host pulls its image and reads secrets as itself, with no registry password', () => {
  assert.match(bicep, /acrUseManagedIdentityCreds: true/)
  assert.match(bicep, /adminUserEnabled: false/)
  assert.match(bicep, /enableRbacAuthorization: true/)
  assert.match(bicep, /healthCheckPath: '\/healthz'/)
  assert.match(bicep, /httpsOnly: true/)
})

test('the deploy workflow is manual only and logs in with federated credentials, not a stored secret', () => {
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/)
  assert.doesNotMatch(workflow, /\n\s*(push|pull_request|schedule):/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /azure\/login@/)
  assert.doesNotMatch(workflow, /AZURE_CREDENTIALS|client-secret|secrets\.AZURE/)
})
