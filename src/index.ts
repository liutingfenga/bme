/**
 * Browser Memory Engine (BME) — Public API
 *
 * Core modules:
 *   db        — IndexedDB schema and scoped helpers (Dexie 4)
 *   services  — Memory extraction, recall, and context injection
 *   types     — All TypeScript interfaces
 *   utils     — BM25 search
 */

// ── Database ──────────────────────────────────────────────
export {
  db,
  dbMessages,
  dbFacts,
  dbEpisodes,
  dbCommitments,
  dbVibe,
  dbSessions,
  dbPersonas,
  dbTasks,
} from './db/index'

// ── Services ──────────────────────────────────────────────
export { buildSystemPrompt, buildMessageHistory } from './services/inject'
export type { ChatMessage } from './services/inject'

export { recall } from './services/recall'

export { runExtraction, enqueueExtraction } from './services/extract'

export { stream, complete, generateTitle } from './services/api'
export type { ApiConfig, StreamChunk } from './services/api'

// ── Types ─────────────────────────────────────────────────
export type {
  MemoryScope,
  PersonaEntity,
  VibeSnapshot,
  RelationshipTension,
  FactEntity,
  FactSourceType,
  EpisodeEntity,
  EpisodeSignificance,
  CommitmentEntity,
  CommitmentStatus,
  MessageRecord,
  MessageSender,
  Session,
  MemoryProposal,
  ProposalType,
  ProposalAction,
  ExtractionTask,
  TaskStatus,
  RecallResult,
  ContextPayload,
} from './types/memory'

// ── Utils ─────────────────────────────────────────────────
export { tokenize, buildIndex, quickSearch } from './utils/bm25'
