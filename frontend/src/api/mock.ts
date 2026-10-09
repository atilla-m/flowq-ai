// MOCK mode (VITE_MOCK=1): an in-browser fake of the FlowQ backend so the UI can be built and
// demoed without the API or an OpenAI key. State lives in localStorage so the /pay tab and the
// main tab see the same orders, messages and events.

import type { Api, Channel, Customer, InboxEvent, Json, Message, MessageType, TraceEntry } from './types'

const KEY = 'flowq-mock-v3'

interface PhoneState {
  quoteId?: string
  baseOffer?: number
  offer?: number
  wantsTradeIn?: boolean
  accessory?: boolean
  deliveryFee?: number
  district?: string
  orderId?: string
  lastMedia?: string[]
}

interface MockOrder extends Json {
  id: string
  order_id: string
  phone: string
  status: 'awaiting_payment' | 'paid'
  ts: string
  items: { sku: string; name: string; kind: 'phone' | 'accessory'; quantity: number; price_azn: number; line_total_azn: number }[]
  tradein: { quote_id?: string; offer: number; credit_azn: number } | null
  delivery: { address: string; district: string; fee_azn: number }
  total: number
  total_azn: number
  currency: 'AZN'
  paid_at: string | null
}

interface Store {
  seq: number
  messages: Record<string, Message[]>
  events: Record<string, InboxEvent[]>
  trace: Record<string, TraceEntry[]>
  orders: Record<string, MockOrder>
  state: Record<string, PhoneState>
}

const CUSTOMERS: (Customer & { history_summary: string })[] = [
  {
    id: 'cust_01',
    name: 'Aysel Məmmədova',
    phone: '+994501234567',
    history_summary: 'Uses iPhone 12 128 GB. Interested in upgrading to iPhone 15 with trade-in. Lives in Yasamal.',
  },
  {
    id: 'cust_02',
    name: 'Elvin Əliyev',
    phone: '+994551234567',
    history_summary: 'Uses Samsung Galaxy S21. Asked about Galaxy S24 and a compatible case. Nərimanov.',
  },
  {
    id: 'cust_03',
    name: 'Nigar Həsənova',
    phone: '+994701234567',
    history_summary: 'Bought iPhone 14 previously. Asked about a pink iPhone 15 as a gift. Nəsimi.',
  },
  {
    id: 'cust_05',
    name: 'Leyla İsmayılova',
    phone: '+994501112233',
    history_summary: 'Asked about trading in iPhone 12 128 GB. Xətai.',
  },
]

const PHONE = { sku: 'IP15-128-BLK', name: 'iPhone 15', storage: 128, color: 'Black', price_azn: 1399, stock: 5 }
const CASE = { sku: 'ACC-006', name: 'iPhone 15 — Protective case', category: 'case', price_azn: 29, stock: 12 }
const MEDIA_INSTRUCTIONS =
  'Please upload four clear images in the WhatsApp panel: 1) the full screen, 2) the back of the phone, ' +
  '3) Settings > Battery > Battery Health screenshot, 4) Settings > General > About screenshot showing model and storage.'
const DISTRICTS = ['Yasamal', 'Nəsimi', 'Nərimanov', 'Xətai', 'Binəqədi', 'Səbail']
const MAX_INCREASE_PCT = 5
const STEP_PCT = 2

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Store
  } catch {
    // corrupted or unavailable storage: start clean
  }
  return { seq: 1, messages: {}, events: {}, trace: {}, orders: {}, state: {} }
}

function save(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // quota exceeded (large photos): keep going in memory for this call
  }
}

/** Read-modify-write so the two tabs never clobber each other's whole snapshot. */
function mutate<T>(fn: (s: Store) => T): T {
  const s = load()
  const out = fn(s)
  save(s)
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()
const st = (s: Store, phone: string) => (s.state[phone] ??= {})

function pushMessage(
  s: Store,
  phone: string,
  from: Message['from'],
  type: MessageType,
  rest: Partial<Message> = {},
): Message {
  const m: Message = { id: `m_${s.seq++}`, ts: iso(), from, type, ...rest }
  ;(s.messages[phone] ??= []).push(m)
  return m
}

function pushEvent(s: Store, phone: string, type: InboxEvent['type'], data: Json, delayMs = 0) {
  ;(s.events[phone] ??= []).push({ id: `e_${s.seq++}`, ts: iso(delayMs), type, data })
}

function svg(label: string, bg: string, fg = '#f8fafc') {
  const body =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">` +
    `<rect width="320" height="200" fill="${bg}"/>` +
    `<rect x="122" y="22" width="76" height="140" rx="14" fill="${fg}" opacity=".92"/>` +
    `<rect x="128" y="30" width="64" height="124" rx="9" fill="${bg}"/>` +
    `<circle cx="160" cy="40" r="3" fill="${fg}" opacity=".6"/>` +
    `<text x="160" y="186" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="${fg}" text-anchor="middle">${label}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(body)}`
}

const PHONE_IMG = svg('iPhone 15 · 128 GB · Black', '#0f172a')
const CASE_IMG = svg('iPhone 15 case', '#0f766e')

// ---------------------------------------------------------------- tools

type ToolFn = (s: Store, phone: string, args: Json, channel: Channel) => Json

const TOOLS: Record<string, ToolFn> = {
  get_customer_history: (_s, phone) => {
    const c = CUSTOMERS.find((x) => x.phone === phone)
    return { name: c?.name ?? null, history_summary: c?.history_summary ?? 'New customer.' }
  },

  search_inventory: (_s, _phone, args) => ({ items: [{ ...PHONE, kind: 'phone' }], currency: 'AZN', query: String(args.query ?? '') }),

  request_media_whatsapp: (s, phone, args) => {
    st(s, phone).wantsTradeIn = true
    const what = typeof args.what === 'string' ? args.what : ''
    const text = what ? `${what}\n${MEDIA_INSTRUCTIONS}` : MEDIA_INSTRUCTIONS
    pushMessage(s, phone, 'agent', 'media_request', { text, data: { what, instructions: MEDIA_INSTRUCTIONS } })
    return { sent: true, instructions: text, channel: 'whatsapp' }
  },

  analyze_device_media: (s, phone, args) => {
    const ids = Array.isArray(args.media_ids) && args.media_ids.length ? args.media_ids : (st(s, phone).lastMedia ?? [])
    if (!ids.length) return { error: 'no_media', message: 'No photos have been uploaded yet.' }
    return {
      analysis_id: `an_${s.seq++}`,
      model: 'iPhone 12',
      storage: 128,
      battery_health: 88,
      screen_cracked: true,
      back_cracked: false,
      confidence: 0.91,
      mismatches: [
        {
          field: 'screen_cracked',
          claimed: false,
          observed: true,
          message: 'Customer said the screen is perfect; the photo shows a crack in the lower right corner',
        },
      ],
    }
  },

  calculate_tradein: (s, phone, args) => {
    const p = st(s, phone)
    p.quoteId = `q_${s.seq++}`
    p.baseOffer = 250
    p.offer = 250
    return {
      quote_id: p.quoteId,
      analysis_id: (args.device_info as Json | undefined)?.analysis_id ?? null,
      base_offer: 350,
      deductions: [{ reason: 'Cracked screen', amount_azn: 100 }],
      final_offer: 250,
      current_offer: 250,
      is_final: false,
    }
  },

  // Same rule as the backend: ceiling = final_offer x 1.05, step = final_offer x 0.02.
  negotiate_offer: (s, phone, args) => {
    const p = st(s, phone)
    if (!p.baseOffer || !p.offer) return { error: 'invalid_request', message: 'First obtain a verified calculate_tradein quote' }
    const max = Math.floor(p.baseOffer * (1 + MAX_INCREASE_PCT / 100) * 100) / 100
    const step = Math.floor(p.baseOffer * STEP_PCT) / 100
    const ask = Number(args.customer_ask ?? Infinity)
    p.offer = ask <= p.offer ? p.offer : Math.min(max, p.offer + step, ask)
    return { new_offer: p.offer, max_offer: max, is_final: p.offer >= max, base_offer: p.baseOffer, currency: 'AZN', quote_id: p.quoteId }
  },

  get_accessories: (s, phone, args) => {
    const item = { ...CASE, compatible_models: ['iPhone 15'], image_url: CASE_IMG, kind: 'accessory' }
    pushMessage(s, phone, 'agent', 'product_card', { text: CASE.name, image_url: CASE_IMG, data: { ...item, currency: 'AZN' } })
    return { phone_model: String(args.phone_model ?? 'iPhone 15'), items: [item], currency: 'AZN' }
  },

  calculate_delivery: (s, phone, args) => {
    const p = st(s, phone)
    const address = String(args.address ?? 'Yasamal')
    const pickup = /pick ?up|in store|collect/i.test(address)
    p.district = pickup ? 'pickup' : (DISTRICTS.find((d) => address.toLowerCase().includes(d.toLowerCase())) ?? 'Yasamal')
    p.deliveryFee = pickup ? 0 : 3
    return { address, district: p.district, fee_azn: p.deliveryFee, currency: 'AZN', needs_clarification: false }
  },

  create_order: (s, phone, args) => {
    const p = st(s, phone)
    const skus = (Array.isArray(args.items) ? args.items : []).map((i) => String((i as Json).sku))
    const line = (sku: string, name: string, kind: 'phone' | 'accessory', price: number) => ({
      sku,
      name,
      kind,
      quantity: 1,
      price_azn: price,
      line_total_azn: price,
      ...(kind === 'phone' ? { storage: PHONE.storage, color: PHONE.color } : {}),
    })
    const items = [line(PHONE.sku, PHONE.name, 'phone', PHONE.price_azn)]
    if (skus.includes(CASE.sku)) items.push(line(CASE.sku, CASE.name, 'accessory', CASE.price_azn))
    const credit = args.tradein_quote_id && args.tradein_quote_id === p.quoteId ? (p.offer ?? 0) : 0
    const fee = p.deliveryFee ?? 3
    const total = items.reduce((a, i) => a + i.line_total_azn, 0) - credit + fee
    const id = `FQ-${String(100000 + s.seq++)}`
    const order: MockOrder = {
      id,
      order_id: id,
      phone,
      ts: iso(),
      items,
      tradein: credit ? { quote_id: p.quoteId, offer: credit, credit_azn: credit } : null,
      delivery: { address: String(args.address ?? 'Yasamal'), district: p.district ?? 'Yasamal', fee_azn: fee },
      total,
      total_azn: total,
      currency: 'AZN',
      status: 'awaiting_payment',
      paid_at: null,
    }
    s.orders[id] = order
    p.orderId = id
    pushMessage(s, phone, 'agent', 'order_summary', { text: `Order ${id}: total ${total.toFixed(2)} AZN.`, data: order })
    pushEvent(s, phone, 'order_update', { order_id: id, status: 'awaiting_payment' })
    return order
  },

  create_payment_link: (s, phone, args) => {
    const order = s.orders[String(args.order_id)]
    if (!order || order.phone !== phone) return { error: 'invalid_request', message: 'Order not found for this customer' }
    if (order.status === 'paid') return { order_id: order.id, status: 'paid', message: 'This order is already paid.' }
    const url = `${location.origin}/pay/${order.id}`
    pushMessage(s, phone, 'agent', 'payment_link', {
      text: 'Payment link:',
      data: { order_id: order.id, url, status: 'pending' },
    })
    return { order_id: order.id, url, status: 'pending' }
  },

  // Reads only. Nothing in the tools can set an order to paid; only mockApi.pay (the endpoint) does.
  check_payment_status: (s, phone, args) => {
    const order = s.orders[String(args.order_id)]
    if (!order || order.phone !== phone) return { error: 'invalid_request', message: 'Order not found for this customer' }
    return {
      order_id: order.id,
      status: order.status === 'paid' ? 'paid' : 'pending',
      paid_at: order.paid_at,
      total_azn: order.total_azn,
    }
  },

  get_order_status: (s, phone, args) => {
    if (args.order_id) {
      const order = s.orders[String(args.order_id)]
      return order && order.phone === phone ? order : { error: 'invalid_request', message: 'Order not found for this customer' }
    }
    return { orders: Object.values(s.orders).filter((o) => o.phone === phone) }
  },

  schedule_callback: (s, phone, args) => {
    const delay = Number(args.delay_seconds ?? 15)
    const scheduled_at = iso(delay * 1000)
    const name = CUSTOMERS.find((c) => c.phone === phone)?.name ?? null
    pushEvent(s, phone, 'incoming_callback', { phone, name, scheduled_at, delay_seconds: delay }, delay * 1000)
    return { scheduled: true, scheduled_at, delay_seconds: delay }
  },

  handoff_to_human: (s, phone, args, channel) => {
    const summary = typeof args.summary === 'string' && args.summary ? args.summary : 'The customer asked to speak to a manager.'
    pushEvent(s, phone, 'handoff', { phone, summary, channel })
    pushMessage(s, phone, 'agent', 'text', { text: 'I am transferring you to a colleague.' })
    return { handed_off: true }
  },
}

async function runTool(name: string, phone: string, channel: Channel, args: unknown): Promise<Json> {
  const latency = 90 + Math.round(Math.random() * 260)
  await sleep(latency)
  return mutate((s) => {
    const fn = TOOLS[name]
    const a = (args && typeof args === 'object' ? args : {}) as Json
    const result = fn ? fn(s, phone, a, channel) : { error: 'unknown_tool', message: `Unknown tool ${name}` }
    ;(s.trace[phone] ??= []).push({ ts: iso(), channel, tool: name, args: a, result, latency_ms: latency })
    return result
  })
}

// ---------------------------------------------------------------- WhatsApp agent turn

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w))

async function chatTurn(phone: string, text: string, mediaIds: string[]): Promise<Message[]> {
  const t = text.toLowerCase()
  const before = load().messages[phone]?.length ?? 0
  const tool = (name: string, args: Json = {}) => runTool(name, phone, 'whatsapp', args)
  const say = (msg: string, type: MessageType = 'text', rest: Partial<Message> = {}) =>
    mutate((s) => pushMessage(s, phone, 'agent', type, { text: msg, ...rest }))
  const state = () => load().state[phone] ?? {}

  const HANDOFF_SUMMARY =
    'Customer is buying an iPhone 15 (128 GB, Black) with an iPhone 12 trade-in and asked to speak to a manager.'

  if (mediaIds.length) {
    const analysis = await tool('analyze_device_media', { media_ids: mediaIds, claimed: { model: 'iPhone 12', screen_cracked: false } })
    const quote = await tool('calculate_tradein', {
      device_info: { analysis_id: analysis.analysis_id, powers_on: true, water_damage: false, repaired_before: false, face_id_working: true, icloud_signed_out: true },
    })
    say(
      `Thanks, I checked the photos. They show a cracked screen, so I am pricing on what the photos show. ` +
        `My trade-in offer for your iPhone 12 128 GB is ${quote.final_offer} AZN (350 minus 100 for the screen).`,
    )
  } else if (has(t, 'manager', 'human', 'real person', 'supervisor')) {
    await tool('handoff_to_human', { summary: HANDOFF_SUMMARY })
  } else if (has(t, 'call me', 'call back', 'callback', 'no balance')) {
    await tool('schedule_callback', { delay_seconds: 8 })
    say('Of course, we will call you back in a few seconds.')
  } else if (has(t, 'paid', 'i sent the money', 'transferred')) {
    const res = state().orderId ? await tool('check_payment_status', { order_id: state().orderId }) : { error: 'no_order' }
    say(
      res.error
        ? 'You do not have an open order yet.'
        : res.status === 'paid'
          ? 'Your payment is confirmed, thank you! We are preparing your order.'
          : 'I do not see a payment in the system yet. Please complete it with the "Pay" button on the link.',
    )
  } else if (has(t, 'where is my order', 'order status', 'track', 'status')) {
    const res = await tool('get_order_status', state().orderId ? { order_id: state().orderId } : {})
    say(
      res.id
        ? `Order ${res.id}: ${res.status === 'paid' ? 'paid and being prepared' : 'awaiting payment'}.`
        : 'You do not have an open order yet.',
    )
  } else if (has(t, 'trade', 'old phone', 'exchange')) {
    await tool('request_media_whatsapp', { what: 'iPhone 12 trade-in' })
    say('I need a few photos to check it. Please follow the instructions above.')
  } else if (has(t, 'more', 'higher', 'too low', 'better price', 'can you do')) {
    const extra = Number(t.match(/(\d+)\s*(azn|manat)?\s*more/)?.[1] ?? 50)
    const res = await tool('negotiate_offer', { quote_id: state().quoteId, customer_ask: (state().offer ?? 0) + extra })
    say(
      res.error
        ? 'Please send photos of the phone first, then we can talk about the price.'
        : res.is_final
          ? `${res.new_offer} AZN is my final offer. I cannot go any higher.`
          : `I can do ${res.new_offer} AZN for you.`,
    )
  } else if (has(t, 'case', 'accessor', 'cover')) {
    await tool('get_accessories', { phone_model: 'iPhone 15' })
    mutate((s) => void (st(s, phone).accessory = true))
    say('A matching protective case for the iPhone 15 is 29 AZN. I added it to your order.')
  } else if (has(t, 'deliver', 'address', 'pick up', 'pickup', ...DISTRICTS.map((d) => d.toLowerCase()))) {
    const res = await tool('calculate_delivery', { address: text })
    say(res.district === 'pickup' ? 'Store pickup is free.' : `Delivery to ${res.district} is ${res.fee_azn} AZN.`)
  } else if (has(t, 'order', 'deal', 'i agree', 'buy', "i'll take", 'go ahead', 'confirm')) {
    if (state().deliveryFee === undefined) await tool('calculate_delivery', { address: 'Yasamal' })
    const cur = state()
    const order = await tool('create_order', {
      items: [{ sku: PHONE.sku, quantity: 1 }, ...(cur.accessory ? [{ sku: CASE.sku, quantity: 1 }] : [])],
      address: cur.district ?? 'Yasamal',
      ...(cur.quoteId ? { tradein_quote_id: cur.quoteId } : {}),
    })
    await tool('create_payment_link', { order_id: order.id })
  } else {
    await tool('search_inventory', { query: text || 'iPhone 15' })
    say('', 'product_card', {
      text: PHONE.name,
      image_url: PHONE_IMG,
      data: { ...PHONE, kind: 'phone', currency: 'AZN' },
    })
    say('Yes, the iPhone 15 128 GB in Black is in stock for 1399 AZN. Would you like to trade in your old phone?')
  }

  return (load().messages[phone] ?? []).slice(before).filter((m) => m.from === 'agent')
}

// ---------------------------------------------------------------- media

function thumbnail(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const src = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, 360 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(src)
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = () => {
      URL.revokeObjectURL(src)
      reject(new Error('Could not read image'))
    }
    img.src = src
  })
}

// ---------------------------------------------------------------- Api

export const mockApi: Api = {
  health: async () => ({ ok: true }),
  customers: async () => CUSTOMERS.map(({ id, name, phone }) => ({ id, name, phone })),

  async customerByPhone(phone) {
    const c = CUSTOMERS.find((x) => x.phone === phone)
    if (!c) throw new Error('Customer not found')
    return c
  },

  async realtimeSession() {
    // Voice in mock mode is a scripted simulation (see voice/mockCall.ts); no OpenAI key exists here.
    throw new Error('Realtime is not available in mock mode')
  },

  callTool: (name, phone, channel, args) => runTool(name, phone, channel, args),

  async chat(phone, text, mediaIds = []) {
    if (text.trim()) mutate((s) => pushMessage(s, phone, 'customer', 'text', { text }))
    await sleep(500)
    return { messages: await chatTurn(phone, text, mediaIds) }
  },

  async uploadMedia(phone, file) {
    const url = await thumbnail(file)
    return mutate((s) => {
      const media_id = `media_${s.seq++}`
      const p = st(s, phone)
      p.lastMedia = [...(p.lastMedia ?? []), media_id].slice(-6)
      pushMessage(s, phone, 'customer', 'image', { image_url: url, data: { media_id } })
      return { media_id, url }
    })
  },

  async inbox(phone, since) {
    const s = load()
    const from = since ? Date.parse(since) : 0
    const now = Date.now()
    const fresh = <T extends { ts: string }>(list: T[] | undefined) =>
      (list ?? []).filter((x) => Date.parse(x.ts) > from && Date.parse(x.ts) <= now)
    return { messages: fresh(s.messages[phone]), events: fresh(s.events[phone]) }
  },

  async order(orderId) {
    const order = load().orders[orderId]
    if (!order) throw new Error(`Order ${orderId} not found`)
    return order
  },

  async pay(orderId) {
    await sleep(700)
    return mutate((s) => {
      const order = s.orders[orderId]
      if (!order) throw new Error(`Order ${orderId} not found`)
      if (order.status !== 'paid') {
        order.status = 'paid'
        order.paid_at = iso()
        pushMessage(s, order.phone, 'agent', 'text', {
          text: `Payment confirmed. Order: ${order.id}.`,
        })
        pushEvent(s, order.phone, 'order_update', { order_id: order.id, status: 'paid' })
      }
      return { status: 'paid' as const }
    })
  },

  trace: async (phone) => load().trace[phone] ?? [],
  endCall: async () => ({ ok: true }),
}

export function resetMock() {
  localStorage.removeItem(KEY)
}
