<template>
  <div class="app">
    <h1>BME Vue Chat</h1>
    <input v-model="userInput" placeholder="Type a message..." @keyup.enter="sendMessage">
    <button @click="sendMessage">Send</button>
    <div class="messages">
      <div v-for="msg in messages" :key="msg.id" class="message" :class="msg.sender">
        <strong>{{ msg.sender }}</strong>: {{ msg.content }}
      </div>
    </div>
    <div class="memory">
      <h2>Extracted Facts</h2>
      <ul>
        <li v-for="fact in facts" :key="fact.id">{{ fact.content }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { db, dbMessages, buildSystemPrompt, stream, enqueueExtraction, runExtraction } from 'browser-memory-engine'

const userInput = ref('')
const messages = ref([])
const facts = ref([])
const userId = 'vue_user'
const apiCfg = {
  apiKey: import.meta.env.VITE_API_KEY || 'sk-your-key',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
}

async function sendMessage() {
  if (!userInput.value.trim()) return
  
  messages.value.push({ id: Date.now(), sender: 'user', content: userInput.value })
  userInput.value = ''
  
  // Stream response and add to chat
  let response = ''
  for await (const chunk of stream(messages.value.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content })), apiCfg)) {
    response += chunk.content
    if (messages.value.length > 0 && messages.value[messages.value.length - 1].sender === 'assistant') {
      messages.value[messages.value.length - 1].content = response
    } else {
      messages.value.push({ id: Date.now(), sender: 'assistant', content: response })
    }
  }
  
  // Load facts
  facts.value = await db.facts.where('userId').equals(userId).toArray()
}

onMounted(async () => {
  facts.value = await db.facts.where('userId').equals(userId).toArray()
})
</script>

<style scoped>
.app { max-width: 600px; margin: 0 auto; padding: 20px; }
.messages { border: 1px solid #ccc; height: 300px; overflow-y: auto; padding: 10px; margin: 10px 0; }
.message { margin: 10px 0; }
.memory ul { list-style: none; }
</style>
