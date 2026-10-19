import { consumeExecutionAuthorization, verifyExecutionAuthorization, type AuthorizationSigningKey, type ExecutionAuthorizationRecord } from '@quicksilver/kernel/runtime'
import { intentFingerprint, SmtpAdapter, type QcsAuthority, type QcsContext, type QcsIntent } from '@quicksilver/qcs'

import { sendSmtpMail, type SmtpOptions } from './smtp.ts'

export interface QcsExecutionBinding {
  runId: string
  nodeId: string
  workflowDigest: string
  approvalDigest: string
  evidenceCount: number
}

export class KernelQcsAuthority implements QcsAuthority {
  private readonly key: AuthorizationSigningKey
  private readonly resolve: (intent: Readonly<QcsIntent>, context: Readonly<QcsContext>) => Promise<QcsExecutionBinding>
  private readonly used = new Set<string>()

  constructor(key: AuthorizationSigningKey, resolve: (intent: Readonly<QcsIntent>, context: Readonly<QcsContext>) => Promise<QcsExecutionBinding>) {
    this.key = { ...key }
    this.resolve = resolve
  }

  async authorizeAndConsume(intent: Readonly<QcsIntent>, context: Readonly<QcsContext>): Promise<void> {
    if (intent.tenant_id !== context.tenant_id || intent.principal_id !== context.principal_id) throw new Error('QCS intent and authenticated context do not match.')
    if (!context.authorization || typeof context.authorization !== 'object') throw new Error('QCS needs a kernel execution grant.')
    const record = structuredClone(context.authorization) as ExecutionAuthorizationRecord
    const binding = await this.resolve(intent, context)
    const checked = verifyExecutionAuthorization(record, this.key, {
      ...binding, tenantId: context.tenant_id, actionFingerprint: intentFingerprint(intent),
    })
    if (!checked.valid || record.capability !== `qcs.${intent.operation}` || this.used.has(record.authorizationId)) throw new Error('QCS grant invalid, stale, mismatched, or already consumed.')
    consumeExecutionAuthorization(record, this.key)
    this.used.add(record.authorizationId)
  }
}

export function createSmtpQcsAdapter(options: SmtpOptions): SmtpAdapter {
  return new SmtpAdapter(async (message) => sendSmtpMail(options, message))
}