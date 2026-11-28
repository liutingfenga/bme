/**
 * BME — IndexedDB schema via Dexie 4
 *
 * Tables:
 *   personas      — M0 PersonaEntity
 *   vibes         — M1 VibeSnapshot
 *   facts         — M2 FactEntity
 *   episodes      — M3 EpisodeEntity
 *   commitments   — M4 CommitmentEntity
 *   messages      — M5 MessageRecord
 *   sessions      — conversation headers
 *   tasks         — ExtractionTask queue
 */

import Dexie, { type EntityTable } from 'dexie'
import type {
  PersonaEntity,
  VibeSnapshot,
  FactEntity,
  EpisodeEntity,
  CommitmentEntity,
  MessageRecord,
  Session,
  ExtractionTask,
} from '@/types/memory'

class BmeDatabase extends Dexie {
  personas!: EntityTable<PersonaEntity, 'id'>
  vibes!: EntityTable<VibeSnapshot, 'id'>
  facts!: EntityTable<FactEntity, 'id'>
  episodes!: EntityTable<EpisodeEntity, 'id'>
  commitments!: EntityTable<CommitmentEntity, 'id'>
  messages!: EntityTable<MessageRecord, 'id'>
  sessions!: EntityTable<Session, 'id'>
  tasks!: EntityTable<ExtractionTask, 'id'>

  constructor() {
    super('bme_v1')

    this.version(1).stores({
      // M0 — Persona
      personas: 'id, characterId, userId, updatedAt',

      // M1 — Vibe
      vibes: 'id, [characterId+userId+worldId], lastUpdated',

      // M2 — Facts
      // Compound index for scope queries + factKey dedup
      facts:
        'id, [characterId+userId+worldId], factKey, [characterId+userId+worldId+factKey], updatedAt',

      // M3 — Episodes
      episodes: 'id, [characterId+userId+worldId], createdAt, significance',

      // M4 — Commitments
      commitments: 'id, [characterId+userId+worldId], status, dueDate',

      // M5 — Raw messages (append-only)
      messages:
        'id, sessionId, [characterId+userId+worldId], timestamp, sender',

      // Session headers
      sessions: 'id, characterId, userId, worldId, updatedAt',

      // Extraction task queue
      tasks: 'id, sessionId, status, createdAt',
    })
  }
}

export const db = new BmeDatabase()

// ─────────────────────────────────────────
// Scope-filtered helpers
// ─────────────────────────────────────────

type Scope = { characterId: string; userId: string; worldId: string }

export const dbMessages = {
  async bySession(sessionId: string): Promise<MessageRecord[]> {
    return db.messages.where('sessionId').equals(sessionId).sortBy('timestamp')
  },
  async recentInScope(scope: Scope, limit = 40): Promise<MessageRecord[]> {
    const all = await db.messages
      .where('[characterId+userId+worldId]')
      .equals([scope.characterId, scope.userId, scope.worldId])
      .sortBy('timestamp')
    return all.slice(-limit)
  },
  async byIds(ids: string[]): Promise<MessageRecord[]> {
    return db.messages.bulkGet(ids).then(r => r.filter(Boolean) as MessageRecord[])
  },
}

export const dbFacts = {
  async activeInScope(scope: Scope): Promise<FactEntity[]> {
    return db.facts
      .where('[characterId+userId+worldId]')
      .equals([scope.characterId, scope.userId, scope.worldId])
      .filter(f => !f.revoked && !f.supersededBy)
      .toArray()
  },
  async byFactKey(scope: Scope, factKey: string): Promise<FactEntity | undefined> {
    return db.facts
      .where('[characterId+userId+worldId+factKey]')
      .equals([scope.characterId, scope.userId, scope.worldId, factKey])
      .filter(f => !f.revoked && !f.supersededBy)
      .first()
  },
}

export const dbEpisodes = {
  async inScope(scope: Scope): Promise<EpisodeEntity[]> {
    return db.episodes
      .where('[characterId+userId+worldId]')
      .equals([scope.characterId, scope.userId, scope.worldId])
      .sortBy('createdAt')
  },
}

export const dbCommitments = {
  async activeInScope(scope: Scope): Promise<CommitmentEntity[]> {
    return db.commitments
      .where('[characterId+userId+worldId]')
      .equals([scope.characterId, scope.userId, scope.worldId])
      .filter(c => c.status === 'pending' || c.status === 'in_progress')
      .toArray()
  },
}

export const dbVibe = {
  async latest(scope: Scope): Promise<VibeSnapshot | undefined> {
    const all = await db.vibes
      .where('[characterId+userId+worldId]')
      .equals([scope.characterId, scope.userId, scope.worldId])
      .toArray()
    return all.sort((a, b) => b.lastUpdated - a.lastUpdated)[0]
  },
}

export const dbSessions = {
  async listForCharacter(characterId: string, userId: string): Promise<Session[]> {
    return db.sessions
      .where('characterId')
      .equals(characterId)
      .filter(s => s.userId === userId)
      .sortBy('updatedAt')
      .then(arr => arr.reverse())
  },
}

export const dbPersonas = {
  async list(userId: string): Promise<PersonaEntity[]> {
    return db.personas.where('userId').equals(userId).toArray()
  },
  async get(characterId: string): Promise<PersonaEntity | undefined> {
    return db.personas.where('characterId').equals(characterId).last()
  },
}

export const dbTasks = {
  async pending(): Promise<ExtractionTask[]> {
    return db.tasks.where('status').anyOf(['pending', 'running']).toArray()
  },
}
