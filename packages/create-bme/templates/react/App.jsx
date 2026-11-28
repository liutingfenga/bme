import { useState, useEffect } from 'react'
import { db, stream } from 'browser-memory-engine'

export default function Chat() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [facts, setFacts] = useState([])

  const apiCfg = {
    apiKey: import.meta.env.VITE_API_KEY || 'sk-your-key',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  }

  async function handleSend() {
    if (!input.trim()) return
    
    setMessages(prev => [...prev, { sender: 'user', content: input }])
    setInput('')
    
    let response = ''
    for await (const chunk of stream(messages.map(m => ({ role: m.sender, content: m.content })), apiCfg)) {
      response += chunk.content
    }
    
    setMessages(prev => [...prev, { sender: 'assistant', content: response }])
    setFacts(await db.facts.toArray())
  }

  useEffect(() => {
    db.facts.toArray().then(setFacts)
  }, [])

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 20 }}>
      <h1>BME React Chat</h1>
      <div style={{ border: '1px solid #ccc', height: 300, overflowY: 'auto', marginBottom: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ padding: 10 }}>
            <strong>{m.sender}:</strong> {m.content}
          </div>
        ))}
      </div>
      <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type..." />
      <button onClick={handleSend}>Send</button>
      <div style={{ marginTop: 20 }}>
        <h2>Facts ({facts.length})</h2>
        <ul>
          {facts.map(f => (
            <li key={f.id}>{f.content}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
