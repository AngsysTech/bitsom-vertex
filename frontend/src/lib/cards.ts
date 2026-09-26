import type { AuditCard, Card, Citation, Message, StudentState } from '@/types'
import { CARD_ORDER } from './labels'

/** A card plus the citations of the message that carried it (card citationIds resolve against these). */
export interface PlacedCard {
  key: string
  card: Card
  citations: Citation[]
  at: string
}

export type LatestCards = Partial<Record<Card['type'], PlacedCard>>

/** Latest card of each type in a thread ("latest wins per type", contracts.ts §3). */
export function latestCards(messages: Message[] | undefined): LatestCards {
  const out: LatestCards = {}
  for (const m of messages ?? [])
    for (const c of m.cards ?? []) out[c.type] = { key: `${m.id}:${c.type}`, card: c, citations: m.citations ?? [], at: m.createdAt }
  return out
}

export const orderedCards = (latest: LatestCards): PlacedCard[] =>
  CARD_ORDER.map((t) => latest[t]).filter((x): x is PlacedCard => !!x)

/** Cards cached in StudentState. They carry citationIds but no Citation objects, so they render without pills. */
export function stateCard(state: StudentState | null, type: Card['type']): PlacedCard | undefined {
  if (!state) return undefined
  const card: Card | undefined =
    type === 'audit' ? state.audit
    : type === 'weak_topics' ? state.weakTopics
    : type === 'study_plan' ? state.plan
    : type === 'skills_gap' ? state.skillsGap
    : undefined
  return card && { key: `state:${type}`, card, citations: [], at: state.updatedAt }
}

/** The audit to show: the thread's (it carries citations) unless StudentState holds a newer run. */
export function freshestAudit(fromThread: PlacedCard | undefined, fromState: PlacedCard | undefined): PlacedCard | undefined {
  if (!fromThread || !fromState) return fromThread ?? fromState
  const t = Date.parse((fromThread.card as AuditCard).computedAt)
  const s = Date.parse((fromState.card as AuditCard).computedAt)
  return s > t ? fromState : fromThread
}

/** Newest card of a type across several threads; falls back to StudentState. */
export function findCard(threads: Message[][], state: StudentState | null, type: Card['type']): PlacedCard | undefined {
  let best: PlacedCard | undefined
  for (const msgs of threads) {
    const p = latestCards(msgs)[type]
    if (p && (!best || Date.parse(p.at) > Date.parse(best.at))) best = p
  }
  if (type === 'audit') return freshestAudit(best, stateCard(state, type))
  return best ?? stateCard(state, type)
}

/** Circulars that change this student's audit: cited by a bucket that isn't ok, or by an unmet prereq. */
export function circularsAffecting(audit: PlacedCard | undefined): Set<string> {
  const out = new Set<string>()
  if (!audit || audit.card.type !== 'audit') return out
  const card = audit.card as AuditCard
  const byId = new Map(audit.citations.map((c) => [c.id, c]))
  const add = (id: string) => {
    const c = byId.get(id)
    if (c) out.add(c.docId)
  }
  card.buckets.filter((b) => b.status !== 'ok').forEach((b) => b.citationIds.forEach(add))
  card.unmetPrereqs.forEach((p) => add(p.citationId))
  return out
}
