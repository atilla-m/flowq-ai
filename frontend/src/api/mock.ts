// MOCK mode (VITE_MOCK=1): an in-browser fake of the FlowQ backend so the UI can be built and
// demoed without the API or an OpenAI key. State lives in localStorage so the /pay tab and the
// main tab see the same orders, messages and events.

import type { Api, Channel, Customer, InboxEvent, Json, Message, MessageType, TraceEntry } from './types'

const KEY = 'flowq-mock-v1'

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
  phone: string
  status: 'awaiting_payment' | 'paid'
  items: { sku: string; name: string; quantity: number; price_azn: number; line_total_azn: number }[]
  tradein: { quote_id?: string; credit_azn: number } | null
  delivery: { district: string; fee_azn: number }
  total_azn: number
  ts: string
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
const CASE = { sku: 'ACC-007', name: 'iPhone 15 — Qoruyucu kabro', category: 'case', price_azn: 29, stock: 12 }
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

type ToolFn = (s: Store, phone: string, args: Json) => Json

const TOOLS: Record<string, ToolFn> = {
  get_customer_history: (_s, phone) => {
    const c = CUSTOMERS.find((x) => x.phone === phone)
    return { name: c?.name ?? null, history_summary: c?.history_summary ?? 'Yeni müştəri.' }
  },

  search_inventory: () => ({ items: [PHONE] }),

  request_media_whatsapp: (s, phone) => {
    st(s, phone).wantsTradeIn = true
    pushMessage(s, phone, 'agent', 'media_request', {
      text: 'Trade-in qiyməti üçün köhnə telefonun şəkillərini göndərin:',
      data: {
        instructions: [
          'Ön tərəf — ekran yanılı vəziyyətdə',
          'Arxa tərəf — kamera görünsün',
          'Ayarlar → Batareya → Batareyanın vəziyyəti ekranı',
          'Ayarlar → Haqqında (model və yaddaş)',
        ],
      },
    })
    return { sent: true, channel: 'whatsapp' }
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

  calculate_tradein: (s, phone) => {
    const p = st(s, phone)
    p.quoteId = `q_${s.seq++}`
    p.baseOffer = 360
    p.offer = 360
    return {
      quote_id: p.quoteId,
      base_value_azn: 480,
      deductions: [
        { reason: 'Ekranda çat var', amount_azn: 100 },
        { reason: 'Batareya 85%-dən aşağıdır', amount_azn: 20 },
      ],
      offer_azn: 360,
    }
  },

  negotiate_offer: (s, phone) => {
    const p = st(s, phone)
    if (!p.baseOffer || !p.offer) return { error: 'no_quote', message: 'Əvvəlcə calculate_tradein çağırılmalıdır.' }
    const max = Math.floor(p.baseOffer * (1 + MAX_INCREASE_PCT / 100))
    const step = Math.round((p.baseOffer * STEP_PCT) / 100)
    const next = Math.min(max, p.offer + step)
    const blocked = p.offer >= max
    p.offer = next
    return {
      quote_id: p.quoteId,
      base_offer_azn: p.baseOffer,
      offer_azn: next,
      max_offer_azn: max,
      is_final: next >= max,
      ...(blocked ? { blocked: true, reason: 'max_offer reached (base_offer × 1.05)' } : {}),
    }
  },

  get_accessories: (s, phone) => {
    pushMessage(s, phone, 'agent', 'product_card', {
      image_url: CASE_IMG,
      data: { sku: CASE.sku, name: CASE.name, price_azn: CASE.price_azn, compatible_models: ['iPhone 15'] },
    })
    return { model: 'iPhone 15', items: [CASE] }
  },

  calculate_delivery: (s, phone, args) => {
    const p = st(s, phone)
    const q = String(args.address ?? args.district ?? 'Yasamal')
    const pickup = /mağaza|magaza|pickup|самовывоз/i.test(q)
    p.district = pickup ? 'Mağazadan götürmə' : /yasamal|ясамал/i.test(q) ? 'Yasamal' : q
    p.deliveryFee = pickup ? 0 : 3
    return { district: p.district, fee_azn: p.deliveryFee, eta: pickup ? 'Bu gün' : '2 saat ərzində' }
  },

  create_order: (s, phone) => {
    const p = st(s, phone)
    const line = (sku: string, name: string, price: number) => ({ sku, name, quantity: 1, price_azn: price, line_total_azn: price })
    const items = [line(PHONE.sku, 'iPhone 15 · 128 GB · Black', PHONE.price_azn)]
    if (p.accessory) items.push(line(CASE.sku, CASE.name, CASE.price_azn))
    const tradein = p.offer ?? 0
    const delivery = p.deliveryFee ?? 0
    const order: MockOrder = {
      id: `ORD-${1000 + s.seq++}`,
      phone,
      status: 'awaiting_payment',
      items,
      tradein: tradein ? { quote_id: p.quoteId, credit_azn: tradein } : null,
      delivery: { district: p.district ?? 'Yasamal', fee_azn: delivery },
      total_azn: items.reduce((a, i) => a + i.line_total_azn, 0) - tradein + delivery,
      ts: iso(),
    }
    s.orders[order.id] = order
    p.orderId = order.id
    pushMessage(s, phone, 'agent', 'order_summary', { data: order })
    return order
  },

  create_payment_link: (s, phone) => {
    const p = st(s, phone)
    const order = p.orderId ? s.orders[p.orderId] : undefined
    if (!order) return { error: 'no_order' }
    const url = `${location.origin}/pay/${order.id}`
    pushMessage(s, phone, 'agent', 'payment_link', {
      text: 'Ödəniş linki hazırdır.',
      data: { order_id: order.id, url, status: 'pending' },
    })
    return { order_id: order.id, url, status: 'pending' }
  },

  check_payment_status: (s, phone) => {
    const p = st(s, phone)
    const order = p.orderId ? s.orders[p.orderId] : undefined
    if (!order) return { error: 'no_order' }
    return { order_id: order.id, status: order.status, paid: order.status === 'paid' }
  },

  get_order_status: (s, phone) => {
    const p = st(s, phone)
    const order = p.orderId ? s.orders[p.orderId] : undefined
    if (!order) return { error: 'no_order' }
    return {
      order_id: order.id,
      status: order.status === 'paid' ? 'out_for_delivery' : order.status,
      eta: order.status === 'paid' ? 'Kuryer yoldadır, təxminən 40 dəqiqə' : null,
    }
  },

  schedule_callback: (s, phone, args) => {
    const delay = Number(args.delay_seconds ?? 8)
    pushEvent(s, phone, 'incoming_callback', { reason: args.reason ?? 'Müştəri geri zəng istədi' }, delay * 1000)
    return { scheduled: true, delay_seconds: delay }
  },

  handoff_to_human: (s, phone, args) => {
    const summary =
      typeof args.summary === 'string' && args.summary
        ? args.summary
        : 'Müştəri iPhone 15 (128 GB, qara) alır, iPhone 13 trade-in edir. Menecerlə danışmaq istədi.'
    pushEvent(s, phone, 'handoff', { summary })
    return { transferred: true, summary }
  },
}

async function runTool(name: string, phone: string, channel: Channel, args: unknown): Promise<Json> {
  const latency = 90 + Math.round(Math.random() * 260)
  await sleep(latency)
  return mutate((s) => {
    const fn = TOOLS[name]
    const a = (args && typeof args === 'object' ? args : {}) as Json
    const result = fn ? fn(s, phone, a) : { error: 'unknown_tool', tool: name }
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

  if (mediaIds.length) {
    const analysis = await tool('analyze_device_media', { media_ids: mediaIds })
    const quote = await tool('calculate_tradein', { analysis_id: analysis.analysis_id })
    say(
      `Şəkilləri yoxladım. Şəkildə ekranın çatladığı görünür, ona görə qiyməti buna əsasən hesablayıram. ` +
        `iPhone 13 128 GB üçün trade-in təklifim: ${quote.offer_azn} AZN (ekran −100, batareya −20).`,
    )
  } else if (has(t, 'menecer', 'operator', 'insan', 'менеджер', 'manager')) {
    await tool('handoff_to_human', {})
    say('Sizi menecerimizə yönləndirirəm, söhbətin xülasəsini ona ötürdüm.')
  } else if (has(t, 'zəng', 'zeng', 'позвон', 'call me')) {
    await tool('schedule_callback', { delay_seconds: 8 })
    say('Əlbəttə, bir neçə saniyəyə sizə zəng edirik.')
  } else if (has(t, 'ödədim', 'odedim', 'оплатил', 'paid')) {
    const res = await tool('check_payment_status')
    say(
      res.paid
        ? 'Ödənişiniz alındı, təşəkkür edirik! Sifariş hazırlanır.'
        : 'Sistemdə ödəniş hələ görünmür. Zəhmət olmasa linkdəki "Pay" düyməsi ilə tamamlayın.',
    )
  } else if (has(t, 'haradadır', 'haradadir', 'status', 'где заказ', 'izlə')) {
    const res = await tool('get_order_status')
    say(res.error ? 'Hələ aktiv sifarişiniz yoxdur.' : `Sifariş ${res.order_id}: ${res.eta ?? 'ödəniş gözlənilir'}.`)
  } else if (has(t, 'trade', 'köhnə', 'kohne', 'dəyiş', 'deyis', 'обмен')) {
    await tool('request_media_whatsapp')
    say('Yoxlamaq üçün bir neçə şəkil lazımdır — yuxarıdakı təlimata baxın.')
  } else if (has(t, 'artır', 'artir', 'azdır', 'azdir', 'endirim', 'мало', 'больше')) {
    const res = await tool('negotiate_offer', { quote_id: state().quoteId })
    say(
      res.error
        ? 'Əvvəlcə telefonun şəkillərini göndərin, sonra qiyməti müzakirə edək.'
        : res.is_final
          ? `Son təklifim ${res.offer_azn} AZN-dir — bundan artıq mümkün deyil.`
          : `Sizin üçün ${res.offer_azn} AZN edə bilərəm.`,
    )
  } else if (has(t, 'kabro', 'aksesuar', 'case', 'чехол')) {
    await tool('get_accessories', { model: 'iPhone 15' })
    mutate((s) => void (st(s, phone).accessory = true))
    say('iPhone 15 üçün uyğun kabro: 29 AZN. Sifarişə əlavə etdim.')
  } else if (has(t, 'çatdır', 'catdir', 'yasamal', 'доставк', 'mağaza', 'ünvan')) {
    const res = await tool('calculate_delivery', { address: text })
    say(`${res.district}: çatdırılma ${res.fee_azn} AZN, ${res.eta}.`)
  } else if (has(t, 'sifariş', 'sifaris', 'razıyam', 'raziyam', 'alıram', 'aliram', 'беру', 'оформ')) {
    if (state().deliveryFee === undefined) await tool('calculate_delivery', { address: 'Yasamal' })
    await tool('create_order', { items: [PHONE.sku], tradein_quote_id: state().quoteId })
    await tool('create_payment_link')
  } else {
    await tool('search_inventory', { query: text || 'iPhone 15' })
    say('', 'product_card', {
      text: undefined,
      image_url: PHONE_IMG,
      data: { sku: PHONE.sku, name: 'iPhone 15 · 128 GB · Black', price_azn: PHONE.price_azn, stock: PHONE.stock },
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
        pushMessage(s, order.phone, 'agent', 'text', {
          text: `Ödənişiniz alındı ✅ Sifariş ${order.id} hazırlanır, kuryer 2 saat ərzində çatdıracaq.`,
        })
        pushEvent(s, order.phone, 'order_update', { order_id: order.id, status: 'paid' })
      }
      return { status: 'paid' }
    })
  },

  trace: async (phone) => load().trace[phone] ?? [],
  endCall: async () => ({ ok: true }),
}

export function resetMock() {
  localStorage.removeItem(KEY)
}
