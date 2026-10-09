// MOCK mode (VITE_MOCK=1): an in-browser fake of the FlowQ backend so the UI can be built and
// demoed without the API or an OpenAI key. State lives in localStorage so the /pay tab and the
// main tab see the same orders, messages and events.

import type { Api, Channel, Customer, InboxEvent, Json, Message, MessageType, TraceEntry } from './types'

const KEY = 'flowq-mock-v2'

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
    history_summary: 'iPhone 13 128 GB istifadə edir. iPhone 15-ə keçmək və trade-in istəyir. Yasamalda yaşayır.',
  },
  {
    id: 'cust_02',
    name: 'Elvin Əliyev',
    phone: '+994551234567',
    history_summary: 'Samsung Galaxy S21 istifadə edir. Galaxy S24 və uyğun kabro ilə maraqlanıb. Nərimanov.',
  },
  {
    id: 'cust_03',
    name: 'Nigar Həsənova',
    phone: '+994701234567',
    history_summary: 'iPhone 14 alıb. Çəhrayı iPhone 15 hədiyyə üçün soruşub. Nəsimi.',
  },
  {
    id: 'cust_05',
    name: 'Leyla İsmayılova',
    phone: '+994501112233',
    history_summary: 'Rusca danışmağa üstünlük verir. iPhone 12 128 GB trade-in ilə maraqlanıb. Xətai.',
  },
]

const PHONE = { sku: 'IP15-128-BLK', name: 'iPhone 15', storage: 128, color: 'Black', price_azn: 1399, stock: 5 }
const CASE = { sku: 'ACC-006', name: 'iPhone 15 — Qoruyucu kabro', category: 'case', price_azn: 29, stock: 12 }
const MEDIA_INSTRUCTIONS =
  'Zəhmət olmasa WhatsApp panelinə 4 aydın şəkil göndərin: 1) ekranın tam görünüşü, 2) arxa tərəf, ' +
  '3) Settings > Battery > Battery Health ekran görüntüsü, 4) Settings > General > About ekran görüntüsü.'
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
    return { name: c?.name ?? null, history_summary: c?.history_summary ?? 'Yeni müştəri.' }
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
    if (!ids.length) return { error: 'no_media', message: 'Heç bir şəkil yüklənməyib.' }
    return {
      analysis_id: `an_${s.seq++}`,
      model: 'iPhone 13',
      storage: 128,
      battery_health: 84,
      screen_cracked: true,
      back_cracked: false,
      confidence: 0.91,
      mismatches: [
        { field: 'screen', claimed: 'İdeal vəziyyətdədir', observed: 'Ekranın sağ aşağı küncündə çat görünür' },
      ],
    }
  },

  calculate_tradein: (s, phone, args) => {
    const p = st(s, phone)
    p.quoteId = `q_${s.seq++}`
    p.baseOffer = 360
    p.offer = 360
    return {
      quote_id: p.quoteId,
      analysis_id: (args.device_info as Json | undefined)?.analysis_id ?? null,
      base_offer: 480,
      deductions: [
        { reason: 'Ekranda çat var', amount_azn: 100 },
        { reason: 'Batareya 85%-dən aşağıdır', amount_azn: 20 },
      ],
      final_offer: 360,
      current_offer: 360,
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
    const pickup = /mağaza|magaza|pickup|самовывоз/i.test(address)
    p.district = pickup ? 'pickup' : /yasamal|ясамал/i.test(address) ? 'Yasamal' : address
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
    pushMessage(s, phone, 'agent', 'order_summary', { text: `Sifariş ${id}: cəmi ${total.toFixed(2)} AZN.`, data: order })
    pushEvent(s, phone, 'order_update', { order_id: id, status: 'awaiting_payment' })
    return order
  },

  create_payment_link: (s, phone, args) => {
    const order = s.orders[String(args.order_id)]
    if (!order || order.phone !== phone) return { error: 'invalid_request', message: 'Order not found for this customer' }
    if (order.status === 'paid') return { order_id: order.id, status: 'paid', message: 'Bu sifariş artıq ödənilib.' }
    const url = `${location.origin}/pay/${order.id}`
    pushMessage(s, phone, 'agent', 'payment_link', {
      text: 'Ödəniş üçün keçid:',
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
    const summary = typeof args.summary === 'string' && args.summary ? args.summary : 'Müştəri menecerlə danışmaq istədi.'
    pushEvent(s, phone, 'handoff', { phone, summary, channel })
    pushMessage(s, phone, 'agent', 'text', { text: 'Sizi əməkdaşımıza yönləndirirəm.' })
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

  const HANDOFF_SUMMARY = 'Müştəri iPhone 15 (128 GB, qara) alır, iPhone 13 trade-in edir. Menecerlə danışmaq istədi.'

  if (mediaIds.length) {
    const analysis = await tool('analyze_device_media', { media_ids: mediaIds, claimed: { model: 'iPhone 13', screen_cracked: false } })
    const quote = await tool('calculate_tradein', {
      device_info: { analysis_id: analysis.analysis_id, powers_on: true, water_damage: false, repaired_before: false, face_id_working: true, icloud_signed_out: true },
    })
    say(
      `Şəkilləri yoxladım. Şəkildə ekranın çatladığı görünür, ona görə qiyməti buna əsasən hesablayıram. ` +
        `iPhone 13 128 GB üçün trade-in təklifim: ${quote.final_offer} AZN (ekran −100, batareya −20).`,
    )
  } else if (has(t, 'menecer', 'operator', 'insan', 'менеджер', 'manager')) {
    await tool('handoff_to_human', { summary: HANDOFF_SUMMARY })
  } else if (has(t, 'zəng', 'zeng', 'позвон', 'call me')) {
    await tool('schedule_callback', { delay_seconds: 8 })
    say('Əlbəttə, bir neçə saniyəyə sizə zəng edirik.')
  } else if (has(t, 'ödədim', 'odedim', 'оплатил', 'paid')) {
    const res = state().orderId ? await tool('check_payment_status', { order_id: state().orderId }) : { error: 'no_order' }
    say(
      res.error
        ? 'Hələ aktiv sifarişiniz yoxdur.'
        : res.status === 'paid'
          ? 'Ödənişiniz təsdiqləndi, təşəkkür edirik! Sifariş hazırlanır.'
          : 'Sistemdə ödəniş hələ görünmür. Zəhmət olmasa linkdəki "Pay" düyməsi ilə tamamlayın.',
    )
  } else if (has(t, 'haradadır', 'haradadir', 'status', 'где заказ', 'izlə')) {
    const res = await tool('get_order_status', state().orderId ? { order_id: state().orderId } : {})
    say(
      res.id
        ? `Sifariş ${res.id}: ${res.status === 'paid' ? 'ödənilib, hazırlanır' : 'ödəniş gözlənilir'}.`
        : 'Hələ aktiv sifarişiniz yoxdur.',
    )
  } else if (has(t, 'trade', 'köhnə', 'kohne', 'dəyiş', 'deyis', 'обмен')) {
    await tool('request_media_whatsapp', { what: 'iPhone 13 trade-in' })
    say('Yoxlamaq üçün bir neçə şəkil lazımdır — yuxarıdakı təlimata baxın.')
  } else if (has(t, 'artır', 'artir', 'azdır', 'azdir', 'endirim', 'мало', 'больше')) {
    const res = await tool('negotiate_offer', { quote_id: state().quoteId, customer_ask: 450 })
    say(
      res.error
        ? 'Əvvəlcə telefonun şəkillərini göndərin, sonra qiyməti müzakirə edək.'
        : res.is_final
          ? `Son təklifim ${res.new_offer} AZN-dir — bundan artıq mümkün deyil.`
          : `Sizin üçün ${res.new_offer} AZN edə bilərəm.`,
    )
  } else if (has(t, 'kabro', 'aksesuar', 'case', 'чехол')) {
    await tool('get_accessories', { phone_model: 'iPhone 15' })
    mutate((s) => void (st(s, phone).accessory = true))
    say('iPhone 15 üçün uyğun kabro: 29 AZN. Sifarişə əlavə etdim.')
  } else if (has(t, 'çatdır', 'catdir', 'yasamal', 'доставк', 'mağaza', 'ünvan')) {
    const res = await tool('calculate_delivery', { address: text })
    say(`${res.district}: çatdırılma ${res.fee_azn} AZN.`)
  } else if (has(t, 'sifariş', 'sifaris', 'razıyam', 'raziyam', 'alıram', 'aliram', 'беру', 'оформ')) {
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
    say('iPhone 15 128 GB qara stokda var — 1399 AZN. Köhnə telefonunuzu trade-in etmək istəyirsiniz?')
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
          text: `Ödənişiniz alındı ✅ Sifariş ${order.id} hazırlanır, kuryer 2 saat ərzində çatdıracaq.`,
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
