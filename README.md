# Browser Memory Engine (BME)

A framework for building AI companions with long-term memory that runs entirely in the browser — no server, no database setup, no cloud.

Memory is stored in **IndexedDB** via [Dexie](https://dexie.org), extracted by any OpenAI-compatible LLM, and recalled using **BM25** keyword search with time-decay reranking.

---

## Architecture

BME organizes memory into six layers (M0–M5):

| Layer | Name | Description |
|-------|------|-------------|
| **M0** | Persona | Character identity, system prompt, interaction boundaries |
| **M1** | Vibe | Relationship atmosphere snapshot (tension, warmth, emotion) |
| **M2** | Facts | User preferences, habits, identity — explicit or inferred |
| **M3** | Episodes | Key emotional events, shared experiences, milestones |
| **M4** | Commitments | Promises and plans between user and AI |
| **M5** | Messages | Raw conversation archive (append-only) |

```
User message
     │
     ▼
buildSystemPrompt()         ← M0 persona + M1 vibe + pinned M2 facts
     + recall()             ← BM25 top-K from M2/M3/M4
     │
     ▼
LLM (any OpenAI-compatible) ← stream() / complete()
     │
     ▼
Save to M5 (messages)
     │
     ▼  (every N turns or on session switch)
runExtraction()             ← LLM extracts proposals → reconcile into M1–M4
```

---

## Install

```bash
npm install browser-memory-engine dexie zod
```

> **Peer dependencies**: `dexie ^4` and `zod ^3` must be installed separately.

---

## Quick Start

```ts
import {
  db,
  dbPersonas,
  dbMessages,
  buildSystemPrompt,
  buildMessageHistory,
  stream,
  enqueueExtraction,
  runExtraction,
} from 'browser-memory-engine'

const userId = 'user_1'

// 1. Create or load a persona (M0)
let personas = await dbPersonas.list(userId)
if (personas.length === 0) {
  await db.personas.add({
    id: 'p1',
    characterId: 'p1',
    userId,
    name: 'Assistant',
    content: 'You are a warm, attentive AI companion.',
    version: 1,
    tags: [],
    boundaries: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  personas = await dbPersonas.list(userId)
}

const persona = personas[0]
const scope = { userId, characterId: persona.characterId, worldId: 'real' }

// 2. Build system prompt with injected memory
const systemPrompt = await buildSystemPrompt(persona, scope, userInput)

// 3. Build chat history from recent messages
const recent = await dbMessages.recentInScope(scope, 20)
const history = buildMessageHistory(recent)

// 4. Stream a response
const apiCfg = { apiKey: 'sk-...', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }

for await (const chunk of stream([{ role: 'system', content: systemPrompt }, ...history], apiCfg)) {
  process.stdout.write(chunk.content)
  if (chunk.done) break
}

// 5. Trigger memory extraction (call after every N turns)
const msgIds = (await dbMessages.bySession(sessionId)).map(m => m.id)
const taskId = await enqueueExtraction(scope, msgIds, sessionId)
await runExtraction(taskId, scope, msgIds, apiCfg)
```

---

## API Reference

### Database helpers

```ts
import { db, dbFacts, dbEpisodes, dbCommitments, dbVibe, dbMessages, dbSessions, dbPersonas } from 'browser-memory-engine'

// Scope-filtered queries
await dbFacts.activeInScope(scope)        // active M2 facts
await dbEpisodes.inScope(scope)           // all M3 episodes
await dbCommitments.activeInScope(scope)  // pending/in-progress M4 commitments
await dbVibe.latest(scope)                // most recent M1 snapshot
await dbMessages.recentInScope(scope, 20) // last 20 messages
```

### Memory extraction

```ts
import { enqueueExtraction, runExtraction } from 'browser-memory-engine'

// Idempotent — creates a task only if one doesn't exist for this message set
const taskId = await enqueueExtraction(scope, messageIds, sessionId)

// Runs the LLM extraction and reconciles proposals into M1–M4
await runExtraction(taskId, scope, messageIds, apiCfg)
```

### Recall

```ts
import { recall } from 'browser-memory-engine'

// BM25 + time-decay, returns top-K relevant memories for a query
const hits = await recall(userQuery, scope, topK = 5, threshold = 0.3)
// hits: Array<{ type: 'fact'|'episode'|'commitment', entity, score, relativeTime }>
```

### Context injection

```ts
import { buildSystemPrompt, buildMessageHistory } from 'browser-memory-engine'

// Assembles: M0 persona + M1 vibe + pinned M2 + M4 commitments + BM25 recall
const systemPrompt = await buildSystemPrompt(persona, scope, latestUserMessage)

// Converts M5 records to [{ role, content }] for the API
const history = buildMessageHistory(recentMessages)
```

### BM25 search

```ts
import { quickSearch, buildIndex, tokenize } from 'browser-memory-engine'

// One-shot search over arbitrary documents
const results = quickSearch(query, [{ id: 'a', text: '...' }], topK, threshold)

// Build a persistent index for repeated queries
const index = buildIndex(docs)
const topMatches = index.topK(query, 5, 0.3)
```

---

## Supported LLM Providers

Any **OpenAI-compatible** endpoint works:

| Provider | Base URL |
|----------|----------|
| DeepSeek | `https://api.deepseek.com` |
| OpenAI | `https://api.openai.com` |
| Qwen (DashScope) | `https://dashscope.aliyuncs.com/compatible-mode` |
| Ollama (local) | `http://localhost:11434` |
| LM Studio | `http://localhost:1234` |
| Any vLLM / llama.cpp server | custom |

---

## License

MIT © [liutingfenga](https://github.com/liutingfenga)
