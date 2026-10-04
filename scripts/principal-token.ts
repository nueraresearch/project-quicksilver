/**
 * Generate a bearer token for QUICKSILVER_PRINCIPALS.
 *   npm run principal:token -- entity-ana supervisor
 *   npm run principal:token -- entity-engineering-agent --kind agent agent-worker
 * Prints the token once (give it to whoever uses it) and the JSON entry to paste
 * into QUICKSILVER_PRINCIPALS, which stores only the token's SHA-256 digest.
 * `--kind` is human (the default), agent or service. An agent or service entity can propose
 * (the agent-worker role) but can never approve: approval needs a human.
 */
import { generateToken } from '../packages/kernel/src/identity/tokens.ts'
import { validatePrincipal, type Principal } from '../packages/kernel/src/identity/rbac.ts'

const args = process.argv.slice(2)
const kindAt = args.indexOf('--kind')
const kind = kindAt >= 0 ? args[kindAt + 1] : 'human'
if (kindAt >= 0) args.splice(kindAt, 2)
if (kind !== 'human' && kind !== 'agent' && kind !== 'service') {
  console.error('--kind must be human, agent or service.')
  process.exit(1)
}
const [id, ...roles] = args
const principal: Principal = {
  id: id ?? '',
  kind,
  tenantId: process.env.QUICKSILVER_TENANT_ID?.trim() || 'default',
  roles: roles.length ? roles : [kind === 'human' ? 'supervisor' : 'agent-worker'],
}
const errors = validatePrincipal(principal)
if (errors.length) {
  console.error(`Usage: npm run principal:token -- <sanity-entity-id> [--kind human|agent|service] [role ...]\n${errors.join('\n')}`)
  process.exit(1)
}
const { token, tokenDigest } = generateToken()
console.log(`Token for ${principal.id} (shown once; send it privately):\n\n  ${token}\n`)
console.log('Add this entry to the QUICKSILVER_PRINCIPALS JSON array:\n')
console.log(`  ${JSON.stringify({ ...principal, tokenDigest })}`)
