import { mockApi } from './mock'
import type { Api, Channel, Inbox, Message, RealtimeSession, TraceEntry } from './types'

export const API_BASE = (import.meta.env.VITE_API_BASE ?? 'http://localhost:8000').replace(/\/+$/, '')
export const IS_MOCK = import.meta.env.VITE_MOCK === '1'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_BASE + path, init)
  } catch {
    // A CORS rejection looks identical to a network failure from inside the browser.
    throw new ApiError(0, `No response from ${API_BASE} (not running, or this origin is not in its ALLOWED_ORIGINS)`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // FastAPI errors arrive as {"detail": "..."}; surface that sentence rather than raw JSON.
    let detail = body.slice(0, 300)
    try {
      const parsed = JSON.parse(body)
      if (typeof parsed?.detail === 'string') detail = parsed.detail
    } catch {
      // not JSON: keep the raw text
    }
    throw new ApiError(res.status, detail || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

const post = <T>(path: string, body: unknown) =>
  http<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const enc = encodeURIComponent

const realApi: Api = {
  health: () => http('/api/health'),
  customers: () => http('/api/customers'),
  customerByPhone: (phone) => http(`/api/customers/by-phone/${enc(phone)}`),
  realtimeSession: (phone) => post<RealtimeSession>('/api/realtime/session', { phone }),

  async callTool(name: string, phone: string, channel: Channel, args: unknown) {
    const res = await post<{ result: unknown }>(`/api/tools/${enc(name)}`, { phone, channel, args })
    return res.result
  },

  chat: (phone, text, mediaIds) =>
    post<{ messages: Message[] }>('/api/chat', {
      phone,
      text,
      ...(mediaIds?.length ? { media_ids: mediaIds } : {}),
    }),

  uploadMedia(phone, file) {
    const form = new FormData()
    form.append('file', file)
    form.append('phone', phone)
    return http('/api/media', { method: 'POST', body: form })
  },

  inbox: (phone, since) =>
    http<Inbox>(`/api/inbox?${new URLSearchParams(since ? { phone, since } : { phone })}`),

  order: (orderId) => http(`/api/orders/${enc(orderId)}`),
  pay: (orderId) => http(`/api/payments/${enc(orderId)}/pay`, { method: 'POST' }),
  trace: (phone) => http<TraceEntry[]>(`/api/trace?${new URLSearchParams({ phone })}`),

  endCall: (phone, transcript) => post('/api/call/end', { phone, transcript }),
}

export const api: Api = IS_MOCK ? mockApi : realApi

/** Backend may return relative media/asset URLs; make them loadable from the Vite origin. */
export function absUrl(url: string | undefined): string | undefined {
  if (!url) return url
  if (/^(https?:|data:|blob:)/.test(url)) return url
  return API_BASE + (url.startsWith('/') ? url : `/${url}`)
}
