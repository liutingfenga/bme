/**
 * BME Minimal Example
 * Core memory extraction and recall loop
 */

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

const userId = 'demo_user'
const apiCfg = {
  apiKey: process.env.API_KEY || 'sk-your-key-here',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
}

async function main() {
  // 1. Create or load persona
  let personas = await db.personas
    .where('userId')
    .equals(userId)
    .toArray()

  if (personas.length === 0) {
    const personaId = `p_${Date.now()}`
    await db.personas.add({
      id: personaId,
      characterId: personaId,
      userId,
      name: 'Assistant',
      content: 'You are a warm, attentive AI companion. Remember user preferences and context.',
      version: 1,
      tags: ['helpful', 'friendly'],
      boundaries: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    personas = await db.personas.where('userId').equals(userId).toArray()
  }

  const persona = personas[0]
  const scope = { userId, characterId: persona.characterId, worldId: 'real' }
  const sessionId = `session_${Date.now()}`

  console.log(`✓ Loaded persona: ${persona.name}`)

  // 2. Simulate conversation loop
  const userMessages = [
    'Hi, I love hiking and photography',
    'My favorite camera is Fujifilm X100V',
    'I usually go hiking on weekends in autumn',
  ]

  for (let i = 0; i < userMessages.length; i++) {
    const userInput = userMessages[i]
    console.log(`\n📝 User: ${userInput}`)

    // Build system prompt with injected context
    const systemPrompt = await buildSystemPrompt(persona, scope, userInput)

    // Build conversation history
    const recentMsgs = await db.messages
      .where('sessionId')
      .equals(sessionId)
      .toArray()
    const history = buildMessageHistory(recentMsgs)

    // Stream response
    console.log('🤖 Assistant: ', end='')
    let assistantResponse = ''
    for await (const chunk of stream(
      [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userInput }],
      apiCfg,
    )) {
      process.stdout.write(chunk.content)
      assistantResponse += chunk.content
      if (chunk.done) break
    }
    console.log('\n')

    // Save to message archive (M5)
    await db.messages.add({
      id: `msg_${Date.now()}_user`,
      sessionId,
      characterId: persona.characterId,
      userId,
      worldId: 'real',
      sender: 'user',
      content: userInput,
      timestamp: Date.now(),
      metadata: {},
    })

    await db.messages.add({
      id: `msg_${Date.now()}_asst`,
      sessionId,
      characterId: persona.characterId,
      userId,
      worldId: 'real',
      sender: 'character',
      content: assistantResponse,
      timestamp: Date.now(),
      metadata: {},
    })

    // Trigger extraction after every 2 messages
    if ((i + 1) % 2 === 0) {
      console.log('\n📊 Extracting memory...')
      const msgIds = (await db.messages.where('sessionId').equals(sessionId).toArray()).map(m => m.id)
      const taskId = await enqueueExtraction(scope, msgIds, sessionId)
      await runExtraction(taskId, scope, msgIds, apiCfg)
      console.log('✓ Memory extraction complete')
    }
  }

  // Show extracted facts
  const facts = await db.facts.where('userId').equals(userId).toArray()
  console.log(`\n✨ Extracted ${facts.length} facts:`)
  facts.forEach(f => console.log(`  - ${f.content}`))
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
