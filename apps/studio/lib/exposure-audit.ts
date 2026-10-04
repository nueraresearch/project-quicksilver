/**
 * What would a public dataset reveal? Pure scanning of documents for the things that make
 * a dataset unsafe to publish: personal identifiers, credential-shaped strings, and free text typed by
 * real people (objectives and questions are stored on evaluation records). It reports where it found
 * something (type and field path) and how many, never the value, so the report can be shared.
 */

export type FindingKind = 'email' | 'phone' | 'credential' | 'url-with-secret' | 'person-id'

export interface Finding {
  kind: FindingKind
  /** `_type` of the document. */
  type: string
  /** Dotted path of the field, with array indexes collapsed to `[]`. */
  path: string
  count: number
}

export interface AuditReport {
  documents: number
  byType: Record<string, number>
  findings: Finding[]
  /** Distinct values of the fields that name a person (requestedBy and similar), classified, never printed. */
  personFields: { path: string; distinct: number; emailLike: number }[]
  /** Free-text fields on records people create (evaluation subjects, decision questions): where real typing lives. */
  freeText: { type: string; path: string; documents: number }[]
  /** Newest and oldest creation time among records people create, to tell seed data from live use. */
  createdRange: { type: string; first: string; last: string }[]
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/
const PHONE = /(?<![\w.])(?:\+?\d[\d ().-]{8,}\d)(?![\w.])/
// Shapes of keys and tokens. Built from pieces so this file never contains a credential-shaped literal itself.
const CREDENTIAL = new RegExp([
  'sk-[A-Za-z0-9_-]{20,}',
  'sk[A-Za-z0-9]{0,3}_(?:live|test)_[A-Za-z0-9]{16,}',
  'ghp_[A-Za-z0-9]{30,}',
  'xox[abprs]-[A-Za-z0-9-]{10,}',
  'AKIA[0-9A-Z]{16}',
  'Bearer\\s+[A-Za-z0-9._~+/=-]{20,}',
  'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}',
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
  'AccountKey=[A-Za-z0-9+/=]{20,}',
].join('|'))
const URL_SECRET = /https?:\/\/[^\s"']*[?&](?:token|key|secret|password|sig|signature)=[^\s"'&]{6,}/i

const PERSON_FIELDS = new Set(['requestedBy', 'proposedBy', 'actorId', 'approvedBy', 'approvedByName', 'createdBy', 'principalId', 'email', 'userId'])
const FREE_TEXT_FIELDS = new Set(['subject', 'question', 'objective', 'reasoningSummary', 'comment', 'note', 'answer', 'summary'])
const CREATED_BY_PEOPLE = new Set(['decision', 'evaluationRecord', 'traceSpan', 'telemetrySpan', 'metricObservation'])

function* walk(value: unknown, path: string): Generator<[string, unknown]> {
  if (Array.isArray(value)) {
    for (const item of value) yield* walk(item, `${path}[]`)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) yield* walk(child, path ? `${path}.${key}` : key)
  } else {
    yield [path, value]
  }
}

const isSystem = (type: string) => type.startsWith('system.') || type.startsWith('sanity.')

export function auditDocuments(docs: readonly Record<string, unknown>[]): AuditReport {
  const byType: Record<string, number> = {}
  const found = new Map<string, Finding>()
  const person = new Map<string, { values: Set<string>; email: number }>()
  const text = new Map<string, Set<string>>()
  const created = new Map<string, { first: string; last: string }>()
  let documents = 0

  for (const doc of docs) {
    const type = typeof doc._type === 'string' ? doc._type : 'unknown'
    if (isSystem(type)) continue
    documents += 1
    byType[type] = (byType[type] ?? 0) + 1
    const id = typeof doc._id === 'string' ? doc._id : String(documents)
    const when = typeof doc._createdAt === 'string' ? doc._createdAt : null
    if (when && CREATED_BY_PEOPLE.has(type)) {
      const range = created.get(type)
      created.set(type, range ? { first: when < range.first ? when : range.first, last: when > range.last ? when : range.last } : { first: when, last: when })
    }
    for (const [path, value] of walk(doc, '')) {
      if (typeof value !== 'string' || !path) continue
      const leaf = path.split('.').at(-1)!.replace(/\[\]$/, '')
      const note = (kind: FindingKind) => {
        const key = `${kind}|${type}|${path}`
        const existing = found.get(key)
        if (existing) existing.count += 1
        else found.set(key, { kind, type, path, count: 1 })
      }
      // ids and references are not text typed by a person
      if (path !== '_id' && !path.endsWith('._ref') && !path.endsWith('._key')) {
        if (CREDENTIAL.test(value)) note('credential')
        if (URL_SECRET.test(value)) note('url-with-secret')
        if (EMAIL.test(value)) note('email')
        else if (PHONE.test(value) && value.length < 400) note('phone')
      }
      if (PERSON_FIELDS.has(leaf)) {
        const entry = person.get(path) ?? { values: new Set<string>(), email: 0 }
        if (!entry.values.has(value)) { entry.values.add(value); if (EMAIL.test(value)) entry.email += 1 }
        person.set(path, entry)
      }
      if (FREE_TEXT_FIELDS.has(leaf) && value.trim().length > 0 && CREATED_BY_PEOPLE.has(type)) {
        const set = text.get(`${type}|${path}`) ?? new Set<string>()
        set.add(id)
        text.set(`${type}|${path}`, set)
      }
    }
  }

  const findings = [...found.values()].sort((a, b) => b.count - a.count)
  return {
    documents,
    byType: Object.fromEntries(Object.entries(byType).sort(([, a], [, b]) => b - a)),
    findings,
    personFields: [...person.entries()].map(([path, v]) => ({ path, distinct: v.values.size, emailLike: v.email })).sort((a, b) => b.distinct - a.distinct),
    freeText: [...text.entries()].map(([key, ids]) => { const [type, ...rest] = key.split('|'); return { type: type!, path: rest.join('|'), documents: ids.size } }).sort((a, b) => b.documents - a.documents),
    createdRange: [...created.entries()].map(([type, r]) => ({ type, ...r })),
  }
}

/** True when something in the report should stop a dataset going public without a person looking first. */
export function needsReview(report: AuditReport): boolean {
  return report.findings.some((f) => f.kind === 'credential' || f.kind === 'url-with-secret' || f.kind === 'email' || f.kind === 'phone')
    || report.personFields.some((f) => f.emailLike > 0)
}
