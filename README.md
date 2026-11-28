# Browser Memory Engine (BME)

**浏览器记忆引擎** — 为 AI 伴侣构建持久长期记忆的开源框架，完全运行在浏览器端，无需服务器、无需数据库配置、无需云服务。

记忆存储在浏览器 **IndexedDB**（通过 [Dexie](https://dexie.org)），由任何 OpenAI 兼容 LLM 提取结构化内容，并通过 **BM25 + 时间衰减** 检索召回。

[English](#english) | 中文

---

## 架构

BME 将记忆分为六层（M0–M5）：

| 层级 | 名称 | 说明 |
|------|------|------|
| **M0** | Persona 人格 | 角色设定、系统提示词、互动底线 |
| **M1** | Vibe 氛围 | 关系氛围快照（张力、话题热度、情绪余温） |
| **M2** | Facts 事实 | 用户偏好、习惯、身份信息（明确或推断） |
| **M3** | Episodes 情景 | 关键情绪事件、共同经历、里程碑时刻 |
| **M4** | Commitments 约定 | 双方的计划、承诺、待办事项 |
| **M5** | Messages 消息 | 原始对话存档（只追加） |

```
用户消息
     │
     ▼
buildSystemPrompt()         ← M0 人格 + M1 氛围 + 锁定的 M2 事实
     + recall()             ← BM25 从 M2/M3/M4 召回 Top-K
     │
     ▼
LLM（任意 OpenAI 兼容接口） ← stream() / complete()
     │
     ▼
存入 M5（消息归档）
     │
     ▼  （每 N 轮或切换会话时触发）
runExtraction()             ← LLM 提取记忆提案 → 写入 M1–M4
```

---

## 安装

```bash
npm install browser-memory-engine dexie zod
```

> **对等依赖**：`dexie ^4` 和 `zod ^3` 需单独安装。

---

## 快速开始

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

// 1. 创建或加载角色（M0）
let personas = await dbPersonas.list(userId)
if (personas.length === 0) {
  await db.personas.add({
    id: 'p1',
    characterId: 'p1',
    userId,
    name: '助手',
    content: '你是一个温暖、细心的 AI 助手。',
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

// 2. 构建注入记忆的系统提示词
const systemPrompt = await buildSystemPrompt(persona, scope, userInput)

// 3. 构建近期消息历史
const recent = await dbMessages.recentInScope(scope, 20)
const history = buildMessageHistory(recent)

// 4. 流式调用 LLM
const apiCfg = { apiKey: 'sk-...', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }

for await (const chunk of stream([{ role: 'system', content: systemPrompt }, ...history], apiCfg)) {
  process.stdout.write(chunk.content)
  if (chunk.done) break
}

// 5. 触发记忆提取（每 N 轮后调用）
const msgIds = (await dbMessages.bySession(sessionId)).map(m => m.id)
const taskId = await enqueueExtraction(scope, msgIds, sessionId)
await runExtraction(taskId, scope, msgIds, apiCfg)
```

---

## API 参考

### 数据库查询

```ts
import { db, dbFacts, dbEpisodes, dbCommitments, dbVibe, dbMessages, dbSessions, dbPersonas } from 'browser-memory-engine'

await dbFacts.activeInScope(scope)        // 有效的 M2 事实
await dbEpisodes.inScope(scope)           // 所有 M3 情景
await dbCommitments.activeInScope(scope)  // 进行中的 M4 约定
await dbVibe.latest(scope)                // 最新的 M1 氛围快照
await dbMessages.recentInScope(scope, 20) // 最近 20 条消息
```

### 记忆提取

```ts
import { enqueueExtraction, runExtraction } from 'browser-memory-engine'

// 幂等创建提取任务（同一消息集不会重复创建）
const taskId = await enqueueExtraction(scope, messageIds, sessionId)

// 调用 LLM 提取并将提案写入 M1–M4
await runExtraction(taskId, scope, messageIds, apiCfg)
```

### 记忆召回

```ts
import { recall } from 'browser-memory-engine'

// BM25 + 时间衰减，返回与当前问题最相关的 Top-K 记忆
const hits = await recall(userQuery, scope, topK = 5, threshold = 0.3)
// hits: Array<{ type: 'fact'|'episode'|'commitment', entity, score, relativeTime }>
```

### 上下文注入

```ts
import { buildSystemPrompt, buildMessageHistory } from 'browser-memory-engine'

// 组装：M0 人格 + M1 氛围 + 锁定 M2 + M4 约定 + BM25 召回
const systemPrompt = await buildSystemPrompt(persona, scope, latestUserMessage)

// 将 M5 消息记录转为 [{ role, content }] 供 API 使用
const history = buildMessageHistory(recentMessages)
```

### BM25 搜索

```ts
import { quickSearch, buildIndex, tokenize } from 'browser-memory-engine'

// 一次性搜索（无需维护索引）
const results = quickSearch(query, [{ id: 'a', text: '...' }], topK, threshold)

// 构建持久化索引（适合重复查询）
const index = buildIndex(docs)
const topMatches = index.topK(query, 5, 0.3)
```

---

## 支持的 LLM 服务商

任何 **OpenAI 兼容接口**均可接入：

| 服务商 | Base URL |
|--------|----------|
| DeepSeek | `https://api.deepseek.com` |
| OpenAI | `https://api.openai.com` |
| 通义千问（DashScope） | `https://dashscope.aliyuncs.com/compatible-mode` |
| Ollama（本地） | `http://localhost:11434` |
| LM Studio | `http://localhost:1234` |
| vLLM / llama.cpp 等本地服务 | 自定义 |

---

## 许可证

MIT © [liutingfenga](https://github.com/liutingfenga)

---

<a id="english"></a>

## English

A framework for building AI companions with long-term memory that runs entirely in the browser — no server, no database setup, no cloud.

Memory is stored in **IndexedDB** via [Dexie](https://dexie.org), extracted by any OpenAI-compatible LLM, and recalled using **BM25** keyword search with time-decay reranking.

### Architecture

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

### Install

```bash
npm install browser-memory-engine dexie zod
```

> **Peer dependencies**: `dexie ^4` and `zod ^3` must be installed separately.

### Quick Start

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

### API Reference

#### Database helpers

```ts
import { db, dbFacts, dbEpisodes, dbCommitments, dbVibe, dbMessages, dbSessions, dbPersonas } from 'browser-memory-engine'

await dbFacts.activeInScope(scope)        // active M2 facts
await dbEpisodes.inScope(scope)           // all M3 episodes
await dbCommitments.activeInScope(scope)  // pending/in-progress M4 commitments
await dbVibe.latest(scope)                // most recent M1 snapshot
await dbMessages.recentInScope(scope, 20) // last 20 messages
```

#### Memory extraction

```ts
import { enqueueExtraction, runExtraction } from 'browser-memory-engine'

// Idempotent — creates a task only if one doesn't exist for this message set
const taskId = await enqueueExtraction(scope, messageIds, sessionId)

// Runs the LLM extraction and reconciles proposals into M1–M4
await runExtraction(taskId, scope, messageIds, apiCfg)
```

#### Recall

```ts
import { recall } from 'browser-memory-engine'

// BM25 + time-decay, returns top-K relevant memories for a query
const hits = await recall(userQuery, scope, topK = 5, threshold = 0.3)
// hits: Array<{ type: 'fact'|'episode'|'commitment', entity, score, relativeTime }>
```

#### Context injection

```ts
import { buildSystemPrompt, buildMessageHistory } from 'browser-memory-engine'

// Assembles: M0 persona + M1 vibe + pinned M2 + M4 commitments + BM25 recall
const systemPrompt = await buildSystemPrompt(persona, scope, latestUserMessage)

// Converts M5 records to [{ role, content }] for the API
const history = buildMessageHistory(recentMessages)
```

#### BM25 search

```ts
import { quickSearch, buildIndex, tokenize } from 'browser-memory-engine'

// One-shot search over arbitrary documents
const results = quickSearch(query, [{ id: 'a', text: '...' }], topK, threshold)

// Build a persistent index for repeated queries
const index = buildIndex(docs)
const topMatches = index.topK(query, 5, 0.3)
```

### Supported LLM Providers

Any **OpenAI-compatible** endpoint works:

| Provider | Base URL |
|----------|----------|
| DeepSeek | `https://api.deepseek.com` |
| OpenAI | `https://api.openai.com` |
| Qwen (DashScope) | `https://dashscope.aliyuncs.com/compatible-mode` |
| Ollama (local) | `http://localhost:11434` |
| LM Studio | `http://localhost:1234` |
| Any vLLM / llama.cpp server | custom |

### License

MIT © [liutingfenga](https://github.com/liutingfenga)
