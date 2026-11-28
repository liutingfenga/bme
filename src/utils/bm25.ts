/**
 * BME — Lightweight BM25 keyword recall for Chinese + mixed text
 *
 * Uses character bigrams (n=2) for Chinese tokenization fallback,
 * combined with whitespace tokenization for Latin words.
 *
 * BM25 params: k1=1.5, b=0.75 (standard defaults)
 */

const K1 = 1.5
const B = 0.75

/** Tokenize a string into terms: whitespace tokens + CJK bigrams */
export function tokenize(text: string): string[] {
  const terms: string[] = []
  // Whitespace split for Latin/numbers
  const words = text.toLowerCase().split(/\s+/)
  for (const w of words) {
    if (!w) continue
    // Check if mostly CJK
    if (/[\u4e00-\u9fff\u3040-\u30ff]/.test(w)) {
      // CJK bigrams
      for (let i = 0; i < w.length - 1; i++) {
        terms.push(w.slice(i, i + 2))
      }
      // Also add single chars for short CJK words
      if (w.length <= 2) terms.push(w)
    } else {
      // Latin / numbers: strip punctuation
      const clean = w.replace(/[^\w]/g, '')
      if (clean) terms.push(clean)
    }
  }
  return terms
}

interface BM25Doc {
  id: string
  terms: string[]
  fieldText: string  // original searchable text (for display)
}

/** Build an in-memory BM25 index from documents */
export function buildIndex(docs: Array<{ id: string; text: string }>): {
  score: (query: string, docId: string) => number
  topK: (query: string, k: number, threshold: number) => Array<{ id: string; score: number }>
} {
  const documents: BM25Doc[] = docs.map(d => ({
    id: d.id,
    terms: tokenize(d.text),
    fieldText: d.text,
  }))

  const N = documents.length
  if (N === 0) {
    return {
      score: () => 0,
      topK: () => [],
    }
  }

  // Average document length
  const avgDL = documents.reduce((acc, d) => acc + d.terms.length, 0) / N

  // Document frequency per term
  const df: Map<string, number> = new Map()
  for (const doc of documents) {
    const unique = new Set(doc.terms)
    for (const t of unique) {
      df.set(t, (df.get(t) ?? 0) + 1)
    }
  }

  // Term frequencies per doc
  const tfMap: Map<string, Map<string, number>> = new Map()
  for (const doc of documents) {
    const tf: Map<string, number> = new Map()
    for (const t of doc.terms) {
      tf.set(t, (tf.get(t) ?? 0) + 1)
    }
    tfMap.set(doc.id, tf)
  }

  function idf(term: string): number {
    const dfVal = df.get(term) ?? 0
    return Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1)
  }

  function scoreDoc(queryTerms: string[], doc: BM25Doc): number {
    const dl = doc.terms.length
    const tf = tfMap.get(doc.id) ?? new Map()
    let s = 0
    for (const t of queryTerms) {
      const tfVal = tf.get(t) ?? 0
      if (tfVal === 0) continue
      const idfVal = idf(t)
      s += idfVal * ((tfVal * (K1 + 1)) / (tfVal + K1 * (1 - B + B * (dl / avgDL))))
    }
    return s
  }

  return {
    score(query: string, docId: string): number {
      const qTerms = tokenize(query)
      const doc = documents.find(d => d.id === docId)
      if (!doc) return 0
      return scoreDoc(qTerms, doc)
    },
    topK(query: string, k: number, threshold: number): Array<{ id: string; score: number }> {
      const qTerms = tokenize(query)
      if (qTerms.length === 0) return []
      return documents
        .map(doc => ({ id: doc.id, score: scoreDoc(qTerms, doc) }))
        .filter(r => r.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
    },
  }
}

/** Quick in-place search without maintaining an index */
export function quickSearch(
  query: string,
  docs: Array<{ id: string; text: string }>,
  k: number,
  threshold: number,
): Array<{ id: string; score: number }> {
  if (!docs.length || !query.trim()) return []
  const idx = buildIndex(docs)
  return idx.topK(query, k, threshold)
}
