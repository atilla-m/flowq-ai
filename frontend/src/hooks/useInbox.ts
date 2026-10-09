import { useCallback, useEffect, useRef, useState } from 'react'
import { absUrl, api } from '../api/client'
import type { InboxEvent, Message } from '../api/types'

const POLL_MS = 2000

function sameContent(a: Message, b: Message) {
  if (a.type !== b.type || a.from !== b.from) return false
  if (a.type === 'image') return absUrl(a.image_url) === absUrl(b.image_url)
  return (a.text ?? '') === (b.text ?? '')
}

/** Backend timestamps carry microseconds; Date.parse only sees milliseconds, so break ties on the string. */
function newer(a: string, b: string) {
  const d = Date.parse(a) - Date.parse(b)
  return d > 0 || (d === 0 && a > b)
}

/** Merge server messages into the list: dedupe by id, and let a server copy replace our optimistic one. */
function merge(prev: Message[], incoming: Message[]): Message[] {
  if (!incoming.length) return prev
  const next = [...prev]
  const ids = new Set(prev.map((m) => m.id))
  for (const m of incoming) {
    if (ids.has(m.id)) continue
    ids.add(m.id)
    const local = next.findIndex((x) => x.id.startsWith('local-') && sameContent(x, m))
    if (local >= 0) next[local] = m
    else next.push(m)
  }
  return next
}

/**
 * Polls GET /api/inbox every 2s for one customer. The first poll loads history; events seen in it
 * are treated as already handled so a page reload doesn't replay an old callback or handoff.
 */
export function useInbox(phone: string, onEvent: (e: InboxEvent) => void) {
  const [messages, setMessages] = useState<Message[]>([])
  const [online, setOnline] = useState(true)
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  })

  useEffect(() => {
    let alive = true
    let since: string | undefined
    let first = true
    const seenEvents = new Set<string>()
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const res = await api.inbox(phone, since)
        if (!alive) return
        setOnline(true)
        const msgs = res.messages ?? []
        const events = res.events ?? []
        for (const item of [...msgs, ...events]) {
          if (!since || newer(item.ts, since)) since = item.ts
        }
        setMessages((prev) => merge(prev, msgs))
        for (const e of events) {
          if (seenEvents.has(e.id)) continue
          seenEvents.add(e.id)
          if (!first) onEventRef.current(e)
        }
        first = false
      } catch {
        if (alive) setOnline(false)
      }
      if (alive) timer = setTimeout(tick, POLL_MS)
    }
    tick()

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [phone])

  const addLocal = useCallback((m: Omit<Message, 'id' | 'ts'>) => {
    const msg: Message = { ...m, id: `local-${crypto.randomUUID()}`, ts: new Date().toISOString() }
    setMessages((prev) => [...prev, msg])
  }, [])

  const mergeServer = useCallback((incoming: Message[]) => {
    setMessages((prev) => merge(prev, incoming))
  }, [])

  return { messages, online, addLocal, mergeServer }
}
