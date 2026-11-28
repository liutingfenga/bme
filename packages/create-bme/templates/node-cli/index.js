#!/usr/bin/env node

import { createInterface } from 'readline'
import { db, stream, enqueueExtraction, runExtraction } from 'browser-memory-engine'

const readline = createInterface({ input: process.stdin, output: process.stdout })
const userId = 'cli_user'
const apiCfg = {
  apiKey: process.env.API_KEY || 'sk-your-key',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
}

async function chat() {
  readline.question('You: ', async input => {
    if (input.toLowerCase() === 'quit') {
      readline.close()
      return
    }
    
    console.log('AI: ', end='')
    let response = ''
    for await (const chunk of stream([{ role: 'user', content: input }], apiCfg)) {
      process.stdout.write(chunk.content)
      response += chunk.content
    }
    console.log()
    
    // Save and extract
    await db.messages.add({
      id: `msg_${Date.now()}`,
      sessionId: 'cli_session',
      characterId: 'cli',
      userId,
      worldId: 'real',
      sender: 'user',
      content: input,
      timestamp: Date.now(),
      metadata: {},
    })
    
    chat()
  })
}

console.log('BME CLI Chat (type "quit" to exit)\n')
chat()
