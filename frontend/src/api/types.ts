// Shapes from the FlowQ shared contract. `data` payloads are loosely typed on purpose:
// the backend owns them, so the UI reads them defensively (see lib/pick.ts).

export type Channel = 'voice' | 'whatsapp'
export type Json = Record<string, unknown>

export interface Customer {
  id: string
  name: string
  phone: string
  history_summary?: string
}

export type MessageType =
  | 'text'
  | 'image'
  | 'product_card'
  | 'payment_link'
  | 'media_request'
  | 'order_summary'

export interface Message {
  id: string
  ts: string
  from: 'agent' | 'customer'
  type: MessageType
  text?: string
  image_url?: string
  data?: Json
}

export interface InboxEvent {
  id: string
  ts: string
  type: 'incoming_callback' | 'order_update' | 'handoff'
  data: Json
}

export interface Inbox {
  messages: Message[]
  events: InboxEvent[]
}

export interface TraceEntry {
  ts: string
  channel: Channel
  tool: string
  args: unknown
  result: unknown
  latency_ms: number
}

export interface RealtimeSession {
  // Ephemeral key. The contract says string; OpenAI's own response nests it as {value}.
  client_secret: string | { value: string }
  model: string
  instructions: string
  tools: unknown[]
  voice?: string
}

export interface Api {
  health(): Promise<{ ok: boolean }>
  customers(): Promise<Customer[]>
  customerByPhone(phone: string): Promise<Customer>
  realtimeSession(phone: string): Promise<RealtimeSession>
  callTool(name: string, phone: string, channel: Channel, args: unknown): Promise<unknown>
  chat(phone: string, text: string, mediaIds?: string[]): Promise<{ messages: Message[] }>
  uploadMedia(phone: string, file: File): Promise<{ media_id: string; url: string }>
  inbox(phone: string, since?: string): Promise<Inbox>
  order(orderId: string): Promise<unknown>
  pay(orderId: string): Promise<{ status: string }>
  trace(phone: string): Promise<TraceEntry[]>
  endCall(phone: string, transcript: string): Promise<{ ok: boolean }>
}
