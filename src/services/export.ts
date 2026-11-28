/**
 * BME — Encrypted Import/Export (§6.1)
 * Uses Web Crypto AES-GCM-256 with PBKDF2 key derivation.
 * API key is EXCLUDED from export by default.
 */

import { db } from '@/db/index'

const MAGIC = 'BME_BACKUP_V1'

interface BackupPayload {
  magic: string
  version: 1
  exportedAt: number
  personas: unknown[]
  vibes: unknown[]
  facts: unknown[]
  episodes: unknown[]
  commitments: unknown[]
  sessions: unknown[]
  messages: unknown[]
}

// ── Key derivation ────────────────────────────────────────

function toBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const passwordBytes = enc.encode(password)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toBuffer(passwordBytes),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toBuffer(salt), iterations: 200_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ── Export ────────────────────────────────────────────────

export async function exportBackup(password: string): Promise<Blob> {
  const [personas, vibes, facts, episodes, commitments, sessions, messages] = await Promise.all([
    db.personas.toArray(),
    db.vibes.toArray(),
    db.facts.toArray(),
    db.episodes.toArray(),
    db.commitments.toArray(),
    db.sessions.toArray(),
    db.messages.toArray(),
  ])

  const payload: BackupPayload = {
    magic: MAGIC,
    version: 1,
    exportedAt: Date.now(),
    personas,
    vibes,
    facts,
    episodes,
    commitments,
    sessions,
    messages,
  }

  const plaintext = toBuffer(new TextEncoder().encode(JSON.stringify(payload)))
  const salt = new Uint8Array(crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer)
  const iv = new Uint8Array(crypto.getRandomValues(new Uint8Array(12)).buffer as ArrayBuffer)
  const key = await deriveKey(password, salt)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toBuffer(iv) }, key, plaintext)

  // Pack: 4 bytes magic len + magic + 32 salt + 12 iv + ciphertext
  const magicBytes = new TextEncoder().encode(MAGIC)
  const buf = new Uint8Array(4 + magicBytes.length + 32 + 12 + ciphertext.byteLength)
  const view = new DataView(buf.buffer)
  view.setUint32(0, magicBytes.length, true)
  buf.set(magicBytes, 4)
  buf.set(salt, 4 + magicBytes.length)
  buf.set(iv, 4 + magicBytes.length + 32)
  buf.set(new Uint8Array(ciphertext), 4 + magicBytes.length + 32 + 12)

  return new Blob([buf], { type: 'application/octet-stream' })
}

// ── Import ────────────────────────────────────────────────

export async function importBackup(file: File, password: string): Promise<void> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const view = new DataView(buf.buffer)

  const magicLen = view.getUint32(0, true)
  const offset = 4 + magicLen

  const salt = buf.slice(offset, offset + 32)
  const iv = buf.slice(offset + 32, offset + 32 + 12)
  const ciphertext = buf.slice(offset + 32 + 12)

  const key = await deriveKey(password, salt)
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBuffer(iv) }, key, toBuffer(ciphertext))
  } catch {
    throw new Error('解密失败，密码可能不正确')
  }

  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload
  if (payload.magic !== MAGIC) throw new Error('无效的备份文件格式')

  // Wipe and restore
  await db.transaction(
    'rw',
    [db.personas, db.vibes, db.facts, db.episodes, db.commitments, db.sessions, db.messages],
    async () => {
      await Promise.all([
        db.personas.clear(),
        db.vibes.clear(),
        db.facts.clear(),
        db.episodes.clear(),
        db.commitments.clear(),
        db.sessions.clear(),
        db.messages.clear(),
      ])
      if (payload.personas?.length) await db.personas.bulkAdd(payload.personas as never[])
      if (payload.vibes?.length) await db.vibes.bulkAdd(payload.vibes as never[])
      if (payload.facts?.length) await db.facts.bulkAdd(payload.facts as never[])
      if (payload.episodes?.length) await db.episodes.bulkAdd(payload.episodes as never[])
      if (payload.commitments?.length) await db.commitments.bulkAdd(payload.commitments as never[])
      if (payload.sessions?.length) await db.sessions.bulkAdd(payload.sessions as never[])
      if (payload.messages?.length) await db.messages.bulkAdd(payload.messages as never[])
    },
  )
}

// ── Helpers ───────────────────────────────────────────────

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
