import { requireText, snapshot } from './config.ts'
import type { AgentIdentity, ChannelType } from '../interfaces/types.ts'

const CHANNELS: readonly ChannelType[] = ['voice', 'sms', 'email', 'signal', 'iot']

export function validateIdentity(identity: AgentIdentity): AgentIdentity {
  const copy = snapshot(identity)
  requireText(copy.agent_id, 'agent id')
  requireText(copy.display_name, 'display name')
  if (!Array.isArray(copy.roles) || !Array.isArray(copy.permissions) || !Array.isArray(copy.channels)) throw new Error('Invalid QCS identity collections.')
  for (const value of [...copy.roles, ...copy.permissions]) requireText(value, 'identity label')
  const used = new Set<ChannelType>()
  for (const binding of copy.channels) {
    if (!CHANNELS.includes(binding.channel_type) || used.has(binding.channel_type)) throw new Error('QCS channel bindings must be supported and unique.')
    requireText(binding.address, 'channel address')
    if (!binding.metadata || Array.isArray(binding.metadata) || typeof binding.metadata !== 'object') throw new Error('QCS binding metadata must be an object.')
    used.add(binding.channel_type)
  }
  return copy
}

export class IdentityRegistry {
  private readonly tenants = new Map<string, Map<string, AgentIdentity>>()

  set(tenantId: string, identity: AgentIdentity): void {
    const copy = validateIdentity(identity)
    const identities = this.tenants.get(tenantId) ?? new Map<string, AgentIdentity>()
    identities.set(copy.agent_id, copy)
    this.tenants.set(tenantId, identities)
  }

  get(tenantId: string, agentId: string): AgentIdentity | null {
    const identity = this.tenants.get(tenantId)?.get(agentId)
    return identity ? snapshot(identity) : null
  }
}