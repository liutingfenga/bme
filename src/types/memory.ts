/**
 * BME — Browser Memory Engine
 * Core TypeScript types for all M0-M5 memory entities
 * Based on BME Spec v2.0 §14.1
 */

// ─────────────────────────────────────────
// Scope (Scope Firewall §3.3)
// ─────────────────────────────────────────

export interface MemoryScope {
  userId: string
  characterId: string
  worldId: string // 'real' | <fiction-id>
}

// ─────────────────────────────────────────
// M0 — Persona Entity (人格设定)
// ─────────────────────────────────────────

export interface PersonaEntity {
  id: string
  characterId: string
  userId: string
  name: string        // display name
  avatar?: string     // data URL or emoji
  content: string     // Markdown full persona
  systemPromptOverride?: string // override system prompt
  version: number
  tags: string[]
  boundaries: string[] // explicit interaction limits
  createdAt: number
  updatedAt: number
}

// ─────────────────────────────────────────
// M1 — Vibe Snapshot (氛围快照)
// ─────────────────────────────────────────

export type RelationshipTension = 'close' | 'distant' | 'neutral' | 'conflicted' | 'playful'

export interface VibeSnapshot {
  id: string
  characterId: string
  userId: string
  worldId: string
  relationshipTension: RelationshipTension
  unfinishedEmotion: string  // e.g. '冷战中', '撒娇中', '安抚中'
  currentTopicWarmth: number // 0-100
  summary: string            // prose summary of recent emotional state
  lastUpdated: number
}

// ─────────────────────────────────────────
// M2 — Fact Entity (事实与偏好)
// ─────────────────────────────────────────

export type FactSourceType = 'explicit' | 'inferred'

export interface FactEntity {
  id: string
  characterId: string
  userId: string
  worldId: string
  factKey: string            // normalized key for dedup
  content: string
  sourceType: FactSourceType
  sourceMessageIds: string[]
  searchTags: string[]       // 5-8 synonym / emotional / scene tags
  version: number
  supersededBy?: string      // id of newer fact
  revoked?: boolean
  userLocked?: boolean
  createdAt: number
  updatedAt: number
}

// ─────────────────────────────────────────
// M3 — Episode Entity (情景与情绪)
// ─────────────────────────────────────────

export type EpisodeSignificance = 'minor' | 'moderate' | 'significant'

export interface EpisodeEntity {
  id: string
  characterId: string
  userId: string
  worldId: string
  title: string
  description: string
  timelineReference: string   // relative: '3天前', '上个月'
  userEmotionAtTime: string
  significance: EpisodeSignificance
  sourceMessageIds: string[]
  searchTags: string[]
  createdAt: number
}

// ─────────────────────────────────────────
// M4 — Commitment Entity (约定状态机)
// ─────────────────────────────────────────

export type CommitmentStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface CommitmentEntity {
  id: string
  characterId: string
  userId: string
  worldId: string
  description: string
  status: CommitmentStatus
  dueDate?: number
  relatedEpisodeIds: string[]
  sourceMessageIds: string[]
  createdAt: number
  updatedAt: number
}

// ─────────────────────────────────────────
// M5 — Message Record (原始档案)
// ─────────────────────────────────────────

export type MessageSender = 'user' | 'character' | 'system'

export interface MessageRecord {
  id: string
  sessionId: string
  characterId: string
  userId: string
  worldId: string
  sender: MessageSender
  content: string
  timestamp: number
  metadata: {
    modelUsed?: string
    emotionalContext?: string
    thinkingContent?: string
  }
}

// ─────────────────────────────────────────
// Session (conversation header)
// ─────────────────────────────────────────

export interface Session {
  id: string
  characterId: string
  userId: string
  worldId: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

// ─────────────────────────────────────────
// Memory Proposal (MemoryProposal §4.3)
// Output from extraction LLM call, validated by Zod
// ─────────────────────────────────────────

export type ProposalType = 'fact' | 'episode' | 'commitment' | 'vibe_update'
export type ProposalAction = 'create' | 'update' | 'supersede' | 'revoke'

export interface MemoryProposal {
  type: ProposalType
  action: ProposalAction
  entity: Partial<FactEntity> | Partial<EpisodeEntity> | Partial<CommitmentEntity> | Partial<VibeSnapshot>
  sourceMessageIds: string[]
  confidence: number    // 0-1
  reasoning: string
}

// ─────────────────────────────────────────
// Extraction Task (batch queue item)
// ─────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface ExtractionTask {
  id: string              // idempotency key
  sessionId: string
  characterId: string
  userId: string
  worldId: string
  messageIds: string[]    // messages to process
  status: TaskStatus
  errorMsg?: string
  createdAt: number
  completedAt?: number
}

// ─────────────────────────────────────────
// App Settings
// ─────────────────────────────────────────

export interface AppSettings {
  apiKey: string
  apiBaseUrl: string
  chatModel: string
  extractModel: string
  language: 'zh' | 'en'
  theme: 'light' | 'dark' | 'auto'
  batchTriggerTurns: number  // default 8
  batchDebounceMs: number    // default 120_000 (2 min)
  recallThreshold: number    // default 0.3 (BM25 score floor)
  recallTopK: number         // default 5
  maxRecentMessages: number  // sliding window default 20
}

// ─────────────────────────────────────────
// Recall result
// ─────────────────────────────────────────

export interface RecallResult {
  type: 'fact' | 'episode' | 'commitment'
  entity: FactEntity | EpisodeEntity | CommitmentEntity
  score: number
  relativeTime: string
}

// ─────────────────────────────────────────
// Chat Message (for API calls)
// ─────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ─────────────────────────────────────────
// Context payload (output of inject.ts)
// ─────────────────────────────────────────

export interface ContextPayload {
  systemPrompt: string
  messages: ChatMessage[]
}
