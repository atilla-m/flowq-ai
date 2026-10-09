import { useCallback, useEffect, useRef, useState } from 'react'
import { absUrl, api } from '../api/client'
import type { InboxEvent, Message } from '../api/types'
import { newer } from '../lib/demoReset'
import { pickStr, toOrderView } from '../lib/pick'

const POLL_MS = 2000

/** The customer's most recent order as the inbox has reported it (for the customer card). */
export interface LastOrder {
  id: string
  total?: number
  status?: string
}

const mediaId = (m: Message) => (typeof m.data?.media_id === 'string' ? m.data.media_id : undefined)

function sameContent(a: Message, b: Message) {
  if (a.type !== b.type || a.from !== b.from) return false
  if (a.type === 'image') {
    const [x, y] = [mediaId(a), mediaId(b)]
    return x && y ? x === y : absUrl(a.image_url) === absUrl(b.image_url)
  }
  return (a.text ?? '') === (b.text ?? '')
}

/** Merge server messages into the list: dedupe by id, and let a server copy replace our optimistic one. */
function merge(prev: Message[], all: Message[], hideUpTo?: string): Message[] {
  // "Reset demo" hides everything the backend already had at reset time.
  const incoming = hideUpTo ? all.filter((m) => newer(m.ts, hideUpTo)) : all
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
 * `hideUpTo` (from "Reset demo") drops server messages up to that timestamp from the view.
 */
export function useInbox(phone: string, onEvent: (e: InboxEvent) => void, hideUpTo?: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [online, setOnline] = useState(true)
  const [lastOrder, setLastOrder] = useState<LastOrder | null>(null)
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  })

  useEffect(() => {
    let alive = true
    let since: string | undefined
    let first = true
    const seenEvents = new Set<string>()
    let latestOrder: LastOrder | null = null
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
        setMessages((prev) => merge(prev, msgs, hideUpTo))

        // Customer-card data: read from everything the backend sends, even what "Reset demo" hides.
        let order = latestOrder
        for (const m of msgs) {
          if (m.type !== 'order_summary') continue
          const o = toOrderView(m.data)
          if (o.id) order = { id: o.id, total: o.total, status: o.status }
        }
        for (const e of events) {
          if (e.type === 'order_update' && order && pickStr(e.data, 'order_id') === order.id)
            order = { ...order, status: pickStr(e.data, 'status') ?? order.status }
        }
        if (order !== latestOrder) {
          latestOrder = order
          setLastOrder(order)
        }
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
  }, [phone, hideUpTo])

  const addLocal = useCallback((m: Omit<Message, 'id' | 'ts'>) => {
    const msg: Message = { ...m, id: `local-${crypto.randomUUID()}`, ts: new Date().toISOString() }
    // POST /api/media already inserts the image into the inbox; if a poll delivered it before the
    // upload response arrived, there is nothing to add.
    setMessages((prev) => (m.type === 'image' && prev.some((x) => sameContent(x, msg)) ? prev : [...prev, msg]))
  }, [])

  const mergeServer = useCallback(
    (incoming: Message[]) => setMessages((prev) => merge(prev, incoming, hideUpTo)),
    [hideUpTo],
  )

  return { messages, online, lastOrder, addLocal, mergeServer }
}
