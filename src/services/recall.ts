/**
 * BME — Two-tier recall service (§5.1)
 *
 * Standard mode: scope filter → keyword BM25 (searchTags + content) →
 *                time-decay rerank → top-K
 * Null-injection guard: returns empty if query is greeting / no hits above threshold
 */

import { dbFacts, dbEpisodes, dbCommitments } from '@/db/index'
import { quickSearch } from '@/utils/bm25'
import type { MemoryScope, RecallResult, FactEntity, EpisodeEntity, CommitmentEntity } from '@/types/memory'

const GREETING_PATTERN =
  /^[\s\p{P}]*(你好|嗨|hi|hello|hey|在吗|在不在|晚上好|早上好|下午好|good morning|good evening|how are you|what's up|wassup|sup)[\s\p{P}]*$/iu

function isGreeting(text: string): boolean {
  return GREETING_PATTERN.test(text.trim())
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const months = Math.floor(days / 30)
  if (mins < 5) return '刚刚'
  if (hours < 1) return `${mins}分钟前`
  if (days < 1) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  if (months < 1) return `${Math.ceil(days / 7)}周前`
  if (months < 12) return `${months}个月前`
  return `${Math.floor(months / 12)}年前`
}

function factSearchText(f: FactEntity): string {
  return [f.content, ...(f.searchTags ?? [])].join(' ')
}
function episodeSearchText(e: EpisodeEntity): string {
  return [e.title, e.description, ...(e.searchTags ?? [])].join(' ')
}
function commitmentSearchText(c: CommitmentEntity): string {
  return c.description
}

/** Time-decay weight: 1.0 at 0 days, ~0.5 at 30 days, ~0.25 at 60 days */
function timeDecay(ts: number): number {
  const days = (Date.now() - ts) / 86_400_000
  return Math.exp(-0.023 * days)
}

export async function recall(
  query: string,
  scope: MemoryScope,
  topK = 5,
  threshold = 0.3,
): Promise<RecallResult[]> {
  // Null-injection guard
  if (isGreeting(query)) return []

  const [facts, episodes, commitments] = await Promise.all([
    dbFacts.activeInScope(scope),
    dbEpisodes.inScope(scope),
    dbCommitments.activeInScope(scope),
  ])

  const factDocs = facts.map(f => ({ id: `f:${f.id}`, text: factSearchText(f) }))
  const episodeDocs = episodes.map(e => ({ id: `e:${e.id}`, text: episodeSearchText(e) }))
  const commitmentDocs = commitments.map(c => ({ id: `c:${c.id}`, text: commitmentSearchText(c) }))

  const allDocs = [...factDocs, ...episodeDocs, ...commitmentDocs]
  if (allDocs.length === 0) return []

  const hits = quickSearch(query, allDocs, topK * 3, threshold)
  if (hits.length === 0) return []

  // Build lookup maps
  const factMap = new Map(facts.map(f => [f.id, f]))
  const episodeMap = new Map(episodes.map(e => [e.id, e]))
  const commitmentMap = new Map(commitments.map(c => [c.id, c]))

  const results: RecallResult[] = []

  for (const hit of hits) {
    const [prefix, id] = hit.id.split(':') as [string, string]

    if (prefix === 'f') {
      const f = factMap.get(id)
      if (!f) continue
      const decay = timeDecay(f.updatedAt)
      results.push({
        type: 'fact',
        entity: f,
        score: hit.score * decay,
        relativeTime: relativeTime(f.updatedAt),
      })
    } else if (prefix === 'e') {
      const e = episodeMap.get(id)
      if (!e) continue
      const sigBoost = e.significance === 'significant' ? 1.3 : e.significance === 'moderate' ? 1.1 : 1.0
      const decay = timeDecay(e.createdAt)
      results.push({
        type: 'episode',
        entity: e,
        score: hit.score * decay * sigBoost,
        relativeTime: relativeTime(e.createdAt),
      })
    } else if (prefix === 'c') {
      const c = commitmentMap.get(id)
      if (!c) continue
      results.push({
        type: 'commitment',
        entity: c,
        score: hit.score * 1.2, // commitments get a priority boost
        relativeTime: relativeTime(c.createdAt),
      })
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
