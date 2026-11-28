/**
 * BME — OpenAI-compatible API client
 * Supports DeepSeek and any OpenAI-compatible endpoint.
 * Streaming via SSE / fetch ReadableStream.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamChunk {
  content: string
  thinking?: string
  done: boolean
}

export interface ApiConfig {
  apiKey: string
  baseUrl: string
  model: string
}

/** Non-streaming completion (for extraction / title generation) */
export async function complete(
  messages: ChatMessage[],
  cfg: ApiConfig,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: false,
      max_tokens: 2048,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>
  }
  return data.choices[0]?.message?.content ?? ''
}

/** Streaming completion — yields StreamChunk objects */
export async function* stream(
  messages: ChatMessage[],
  cfg: ApiConfig,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${text}`)
  }

  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete SSE lines
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') {
          if (trimmed === 'data: [DONE]') {
            yield { content: '', done: true }
          }
          continue
        }
        if (!trimmed.startsWith('data: ')) continue

        try {
          const json = JSON.parse(trimmed.slice(6)) as {
            choices: Array<{
              delta: {
                content?: string
                reasoning_content?: string
              }
              finish_reason?: string
            }>
          }
          const delta = json.choices[0]?.delta
          if (!delta) continue

          const content = delta.content ?? ''
          const thinking = delta.reasoning_content ?? ''
          const done = json.choices[0]?.finish_reason === 'stop'

          if (content || thinking || done) {
            yield { content, thinking: thinking || undefined, done }
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Generate a short conversation title */
export async function generateTitle(
  firstUserMessage: string,
  cfg: ApiConfig,
): Promise<string> {
  try {
    const title = await complete(
      [
        {
          role: 'system',
          content:
            '你是标题生成器。根据用户的第一条消息，生成一个简短的对话标题（10字以内，不加标点）。只返回标题本身，不要解释。',
        },
        { role: 'user', content: firstUserMessage.slice(0, 200) },
      ],
      { ...cfg, model: cfg.model },
      undefined,
    )
    return title.trim().slice(0, 30) || '新对话'
  } catch {
    return '新对话'
  }
}
