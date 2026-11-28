/**
 * BME — Batch Memory Extraction Service (§4.2, §4.3)
 *
 * Trigger conditions (any one):
 *   1. Unprocessed turns ≥ batchTriggerTurns (default 8)
 *   2. User silent > batchDebounceMs (default 2 min)
 *   3. Session switch / explicit flush
 *
 * Flow:
 *   messages → LLM extraction prompt → MemoryProposal[] (Zod-validated)
 *             → ReconcileService → persist M1-M4
 */

import { z } from 'zod'
import { db, dbMessages, dbFacts } from '@/db/index'
import { complete } from './api'
import type { ApiConfig } from './api'
import type {
  MemoryProposal,
  CommitmentEntity,
  VibeSnapshot,
  MemoryScope,
} from '@/types/memory'

// ─── Zod schema for LLM output ───────────────────────────
// Use passthrough + loose validation so minor field-name variations from the
// LLM don't discard the whole proposal. Aliasing is handled during applyProposal.

const FactSchema = z.object({
  factKey: z.string().min(1).optional(),
  content: z.string().min(1),
  // accept "sourceType" or LLM alias "nature"
  sourceType: z.enum(['explicit', 'inferred']).optional(),
  nature: z.enum(['explicit', 'inferred']).optional(),
  searchTags: z.array(z.string()).default([]),
}).passthrough()

const EpisodeSchema = z.object({
  title: z.string().min(1),
  // accept "description" or LLM alias "summary"
  description: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  timelineReference: z.string().optional(),
  // accept "userEmotionAtTime" or LLM alias "emotion"
  userEmotionAtTime: z.string().optional(),
  emotion: z.string().optional(),
  significance: z.enum(['minor', 'moderate', 'significant']).optional(),
  searchTags: z.array(z.string()).default([]),
}).passthrough()

const CommitmentSchema = z.object({
  description: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  dueDate: z.number().optional(),
}).passthrough()

const VibeSchema = z.object({
  relationshipTension: z.enum(['close', 'distant', 'neutral', 'conflicted', 'playful']).optional(),
  unfinishedEmotion: z.string().optional(),
  currentTopicWarmth: z.number().min(0).max(100).optional(),
  summary: z.string().optional(),
}).passthrough()

const ProposalSchema = z.object({
  type: z.enum(['fact', 'episode', 'commitment', 'vibe_update']),
  action: z.enum(['create', 'update', 'supersede', 'revoke']),
  entity: z.union([FactSchema, EpisodeSchema, CommitmentSchema, VibeSchema]),
  sourceMessageIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

const ExtractionResponseSchema = z.object({
  proposals: z.array(ProposalSchema),
})

// ─── Extraction prompt ────────────────────────────────────

function buildExtractionPrompt(
  messages: Array<{ id: string; sender: string; content: string; timestamp: number }>,
  _scope: MemoryScope,
): string {
  const firstId = messages[0]?.id ?? 'example-id'
  const msgLines = messages
    .map(m => `${m.id}\t${m.sender === 'user' ? 'USER' : 'AI'}: ${m.content}`)
    .join('\n')

  return `你是记忆提取引擎，从以下对话中提取结构化记忆，以 JSON 格式返回。

## 对话记录（格式：消息ID<TAB>角色: 内容）
${msgLines}

## 提取规则与字段定义

### facts（M2）- 用户偏好、习惯、身份、关系设定
- 仅从 USER 发言提取
- 字段：
  - factKey (string): 唯一键，如"喜欢的水果"
  - content (string): 完整表述
  - sourceType (string): "explicit" 或 "inferred"
  - searchTags (array<string>): 5-8 个中文同义词/标签

### episodes（M3）- 关键情绪事件、共同经历、里程碑
- 字段：
  - title (string): 事件标题
  - description (string): 详细描述
  - timelineReference (string): 时间参考，如"最近"、"昨天"
  - userEmotionAtTime (string): 用户当时的情感
  - significance (string): "minor"、"moderate" 或 "significant"
  - searchTags (array<string>): 5-8 个中文同义词

### commitments（M4）- 双方约定、计划、承诺
- 字段：
  - description (string): 约定内容
  - status (string): "pending"、"in_progress"、"completed" 或 "cancelled"
  - dueDate (number, optional): 截止时间戳（可不填）

### vibe_update（M1）- 关系氛围快照（每次提取仅1条）
- 字段：
  - relationshipTension (string): "close" (亲近)、"distant" (疏远)、"neutral" (平和)、"conflicted" (紧张) 或 "playful" (活泼)
  - unfinishedEmotion (string): 当前未完结的情绪
  - currentTopicWarmth (number): 话题热度 0-100
  - summary (string): 氛围总结

### 通用字段（所有 proposal）
- type (string): "fact"、"episode"、"commitment" 或 "vibe_update"
- action (string): "create"、"update"、"supersede" 或 "revoke"
- entity (object): 上述对应类型的字段对象
- sourceMessageIds (array<string>): 直接使用 TAB 前的消息 ID（例：["${firstId}"]），不要加括号
- confidence (number): 0-1，提取置信度
- reasoning (string): 简短理由

## 输出格式（JSON only，不要有多余文字）
{
  "proposals": [
    {
      "type": "fact",
      "action": "create",
      "entity": {
        "factKey": "喜欢的水果",
        "content": "用户喜欢吃草莓",
        "sourceType": "explicit",
        "searchTags": ["草莓", "水果", "喜欢", "偏好", "口味"]
      },
      "sourceMessageIds": ["${firstId}"],
      "confidence": 0.95,
      "reasoning": "用户明确说过"
    }
  ]
}

只输出 JSON，不要 markdown 代码块。`
}

// ─── Reconciliation ───────────────────────────────────────

function nanoid(): string {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36)
}

async function applyProposal(proposal: MemoryProposal, scope: MemoryScope): Promise<void> {
  const now = Date.now()

  if (proposal.type === 'fact') {
    const e = proposal.entity as any
    // Normalize aliases: "nature" → "sourceType"
    const sourceType = e.sourceType ?? e.nature ?? 'inferred'
    // Auto-generate factKey from content if missing
    const factKey = e.factKey || e.content.slice(0, 20)
    const content = e.content
    if (!factKey || !content) return

    if (proposal.action === 'create') {
      // Check for existing fact with same key
      const existing = await dbFacts.byFactKey(scope, factKey)
      if (existing) {
        // Dedup: just append sourceMessageIds
        await db.facts.update(existing.id, {
          sourceMessageIds: [...new Set([...existing.sourceMessageIds, ...proposal.sourceMessageIds])],
          updatedAt: now,
        })
        return
      }
      await db.facts.add({
        id: nanoid(),
        characterId: scope.characterId,
        userId: scope.userId,
        worldId: scope.worldId,
        factKey,
        content,
        sourceType,
        sourceMessageIds: proposal.sourceMessageIds,
        searchTags: e.searchTags ?? [],
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
    } else if (proposal.action === 'supersede') {
      const existing = await dbFacts.byFactKey(scope, e.factKey)
      const newId = nanoid()
      await db.facts.add({
        id: newId,
        characterId: scope.characterId,
        userId: scope.userId,
        worldId: scope.worldId,
        factKey: e.factKey!,
        content: e.content!,
        sourceType: e.sourceType ?? 'inferred',
        sourceMessageIds: proposal.sourceMessageIds,
        searchTags: e.searchTags ?? [],
        version: (existing?.version ?? 0) + 1,
        createdAt: now,
        updatedAt: now,
      })
      if (existing && !existing.userLocked) {
        await db.facts.update(existing.id, { supersededBy: newId, updatedAt: now })
      }
    }
  } else if (proposal.type === 'episode') {
    const e = proposal.entity as any
    // Normalize aliases: "summary" → "description", "emotion" → "userEmotionAtTime"
    const title = e.title
    const description = e.description ?? e.summary
    if (!title || !description) return
    if (proposal.action === 'create') {
      await db.episodes.add({
        id: nanoid(),
        characterId: scope.characterId,
        userId: scope.userId,
        worldId: scope.worldId,
        title,
        description,
        timelineReference: e.timelineReference ?? '最近',
        userEmotionAtTime: e.userEmotionAtTime ?? e.emotion ?? '',
        significance: e.significance ?? 'minor',
        sourceMessageIds: proposal.sourceMessageIds,
        searchTags: e.searchTags ?? [],
        createdAt: now,
      })
    }
  } else if (proposal.type === 'commitment') {
    const e = proposal.entity as Partial<CommitmentEntity>
    if (!e.description) return
    if (proposal.action === 'create') {
      await db.commitments.add({
        id: nanoid(),
        characterId: scope.characterId,
        userId: scope.userId,
        worldId: scope.worldId,
        description: e.description,
        status: e.status ?? 'pending',
        dueDate: e.dueDate,
        relatedEpisodeIds: [],
        sourceMessageIds: proposal.sourceMessageIds,
        createdAt: now,
        updatedAt: now,
      })
    }
  } else if (proposal.type === 'vibe_update') {
    const e = proposal.entity as any
    // Always overwrite
    const existing = await db.vibes
      .where('[characterId+userId+worldId]')
      .equals([scope.characterId, scope.userId, scope.worldId])
      .first()

    const vibeData: VibeSnapshot = {
      id: existing?.id ?? nanoid(),
      characterId: scope.characterId,
      userId: scope.userId,
      worldId: scope.worldId,
      relationshipTension: e.relationshipTension ?? 'neutral',
      unfinishedEmotion: e.unfinishedEmotion ?? '',
      currentTopicWarmth: e.currentTopicWarmth ?? 50,
      summary: e.summary ?? '',
      lastUpdated: now,
    }
    if (existing) {
      await db.vibes.put(vibeData)
    } else {
      await db.vibes.add(vibeData)
    }
  }
}

// ─── Main extraction function ─────────────────────────────

export async function runExtraction(
  taskId: string,
  scope: MemoryScope,
  messageIds: string[],
  apiCfg: ApiConfig,
): Promise<void> {
  // Mark task as running
  await db.tasks.update(taskId, { status: 'running' })

  try {
    const messages = await dbMessages.byIds(messageIds)
    if (messages.length === 0) {
      await db.tasks.update(taskId, { status: 'completed', completedAt: Date.now() })
      return
    }

    const prompt = buildExtractionPrompt(
      messages.map(m => ({
        id: m.id,
        sender: m.sender,
        content: m.content,
        timestamp: m.timestamp,
      })),
      scope,
    )

    const rawOutput = await complete(
      [{ role: 'user', content: prompt }],
      apiCfg,
    )

    // Parse and validate
    let parsed: z.infer<typeof ExtractionResponseSchema>
    try {
      // Strip possible markdown code fences
      const cleaned = rawOutput.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim()
      parsed = ExtractionResponseSchema.parse(JSON.parse(cleaned))
    } catch {
      await db.tasks.update(taskId, {
        status: 'failed',
        errorMsg: 'Invalid extraction output',
        completedAt: Date.now(),
      })
      return
    }

    // Apply proposals (reconcile)
    for (const proposal of parsed.proposals) {
      if (proposal.confidence < 0.5) continue // Skip low-confidence
      // Validate sourceMessageIds exist; strip accidental brackets LLMs sometimes add
      const sanitized = proposal.sourceMessageIds.map(id =>
        id.replace(/^\[|\]$/g, '').trim(),
      )
      const validIds = sanitized.filter(id => messages.some(m => m.id === id))
      if (validIds.length === 0 && proposal.type !== 'vibe_update') continue

      await applyProposal({ ...proposal, sourceMessageIds: validIds } as MemoryProposal, scope)
    }

    await db.tasks.update(taskId, { status: 'completed', completedAt: Date.now() })
  } catch (err) {
    await db.tasks.update(taskId, {
      status: 'failed',
      errorMsg: err instanceof Error ? err.message : String(err),
      completedAt: Date.now(),
    })
  }
}

/** Create and queue an extraction task */
export async function enqueueExtraction(
  scope: MemoryScope,
  messageIds: string[],
  sessionId: string,
): Promise<string> {
  // Use the last message id so each new message set gets a fresh task
  const lastMsgId = messageIds[messageIds.length - 1] ?? 'empty'
  const id = `task-${sessionId}-${lastMsgId}`
  // Idempotent: don't re-queue if already exists
  const existing = await db.tasks.get(id)
  if (existing) return id

  await db.tasks.add({
    id,
    sessionId,
    characterId: scope.characterId,
    userId: scope.userId,
    worldId: scope.worldId,
    messageIds,
    status: 'pending',
    createdAt: Date.now(),
  })
  return id
}
