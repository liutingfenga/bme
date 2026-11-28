/**
 * BME — Context Builder / Prompt Injection (§5.3)
 *
 * Assembles the system prompt in four layers:
 *   1. Core Resident  : M0 persona + M1 vibe + key M2 facts (always present)
 *   2. Dynamic Recall : M2/M3/M4 hits from BM25 recall (threshold-gated)
 *   3. Subconscious   : anti-broadcast instruction (never reference memory explicitly)
 *   4. Recent Context : last N turns from M5 (handled by chat store)
 */

import { dbVibe, dbFacts, dbCommitments } from '@/db/index'
import { recall } from './recall'
import type {
  PersonaEntity,
  MemoryScope,
  RecallResult,
  FactEntity,
  CommitmentEntity,
  EpisodeEntity,
  ChatMessage,
} from '@/types/memory'

// Re-export ChatMessage alias so callers can import from one place
export type { ChatMessage }

const SUBCONSCIOUS_ZH = `
【记忆使用约束 — 仅限内部参考，绝对不要对外提及】
- 下方"动态记忆"是你脑海里自然浮现的印象，不是剧本。
- 只在当前话题自然涉及时顺带流露，禁止说"我记得你说过……"等播报式句式。
- 禁止刻意炫耀或反复强调记忆内容。
- 严禁在没有记忆依据时编造共同经历。
- 时间标注仅供你感知时序，无需复述给用户。
`.trim()

function formatFact(f: FactEntity, relTime: string): string {
  const tag = f.sourceType === 'inferred' ? '(推断)' : ''
  return `• ${f.content}${tag}  [${relTime}]`
}

function formatEpisode(e: EpisodeEntity, relTime: string): string {
  return `• [${e.title}] ${e.description}  [${relTime}]`
}

function formatCommitment(c: CommitmentEntity, relTime: string): string {
  const statusMap: Record<string, string> = {
    pending: '待完成',
    in_progress: '进行中',
    completed: '已完成',
    cancelled: '已取消',
  }
  return `• 约定: ${c.description}（${statusMap[c.status] ?? c.status}）  [${relTime}]`
}

export async function buildSystemPrompt(
  persona: PersonaEntity,
  scope: MemoryScope,
  latestUserMessage: string,
  recallTopK = 5,
  recallThreshold = 0.3,
): Promise<string> {
  const parts: string[] = []

  // ── Layer 1: Core Resident ──────────────────────────────
  if (persona.systemPromptOverride) {
    parts.push(persona.systemPromptOverride)
  } else {
    parts.push(`# 角色人格\n${persona.content}`)

    if (persona.boundaries.length > 0) {
      parts.push(`\n## 互动底线\n${persona.boundaries.map(b => `- ${b}`).join('\n')}`)
    }
  }

  // M1 — Vibe snapshot
  const vibe = await dbVibe.latest(scope)
  if (vibe && vibe.unfinishedEmotion) {
    parts.push(
      `\n## 当前关系氛围\n关系张力：${vibe.relationshipTension}，情绪余温：${vibe.unfinishedEmotion}，话题热度：${vibe.currentTopicWarmth}/100。\n${vibe.summary}`,
    )
  }

  // M2 — Key pinned facts (userLocked=true or high-importance items)
  const coreFacts = await dbFacts.activeInScope(scope)
  const pinned = coreFacts.filter(f => f.userLocked).slice(0, 5)
  if (pinned.length > 0) {
    const lines = pinned.map(f => `• ${f.content}`).join('\n')
    parts.push(`\n## 核心用户信息\n${lines}`)
  }

  // M4 — Active commitments (always remind)
  const commitments = await dbCommitments.activeInScope(scope)
  if (commitments.length > 0) {
    const lines = commitments
      .slice(0, 3)
      .map(c => `• ${c.description}（${c.status === 'pending' ? '待完成' : '进行中'}）`)
      .join('\n')
    parts.push(`\n## 未完成约定\n${lines}`)
  }

  // ── Layer 2: Dynamic Recall ─────────────────────────────
  const hits: RecallResult[] = await recall(latestUserMessage, scope, recallTopK, recallThreshold)

  if (hits.length > 0) {
    const recallLines: string[] = []
    for (const hit of hits) {
      if (hit.type === 'fact') {
        recallLines.push(formatFact(hit.entity as FactEntity, hit.relativeTime))
      } else if (hit.type === 'episode') {
        recallLines.push(formatEpisode(hit.entity as EpisodeEntity, hit.relativeTime))
      } else if (hit.type === 'commitment') {
        recallLines.push(formatCommitment(hit.entity as CommitmentEntity, hit.relativeTime))
      }
    }
    if (recallLines.length > 0) {
      parts.push(`\n## 动态记忆（相关印象，仅供参考）\n${recallLines.join('\n')}`)
    }
  }

  // ── Layer 3: Subconscious Instruction ───────────────────
  parts.push(`\n---\n${SUBCONSCIOUS_ZH}`)

  return parts.join('\n')
}

/** Convert M5 messages (recent window) to API chat messages */
export function buildMessageHistory(
  recentMessages: Array<{ sender: 'user' | 'character' | 'system'; content: string }>,
): ChatMessage[] {
  return recentMessages
    .filter(m => m.sender !== 'system')
    .map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.content,
    })) as ChatMessage[]
}
