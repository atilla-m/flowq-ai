import type { Json } from '../api/types'

// Tolerant readers for backend-owned payloads whose exact field names aren't pinned by the contract.

export function asObj(v: unknown): Json {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
}

export function pickStr(o: unknown, ...keys: string[]): string | undefined {
  const obj = asObj(o)
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

export function pickNum(o: unknown, ...keys: string[]): number | undefined {
  const obj = asObj(o)
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  }
  return undefined
}

export function pickArr(o: unknown, ...keys: string[]): unknown[] {
  const obj = asObj(o)
  for (const k of keys) {
    const v = obj[k]
    if (Array.isArray(v)) return v
  }
  return []
}

export interface OrderLine {
  name: string
  qty: number
  price?: number
}

export interface OrderView {
  id?: string
  status?: string
  paid: boolean
  items: OrderLine[]
  tradeIn?: number
  delivery?: number
  address?: string
  total?: number
}

export function toOrderView(raw: unknown): OrderView {
  const root = asObj(raw)
  const o = root.order && typeof root.order === 'object' ? asObj(root.order) : root
  const status = pickStr(o, 'status')
  const items = pickArr(o, 'items', 'lines', 'line_items').map((it): OrderLine => {
    const qty = pickNum(it, 'qty', 'quantity') ?? 1
    const storage = pickNum(it, 'storage')
    return {
      name:
        [pickStr(it, 'name', 'title', 'sku'), storage ? `${storage} GB` : undefined, pickStr(it, 'color', 'variant')]
          .filter(Boolean)
          .join(' · ') || 'Item',
      qty,
      price: pickNum(it, 'line_total_azn', 'total_azn', 'price_azn', 'unit_price_azn', 'price', 'amount'),
    }
  })
  const delivery = asObj(o.delivery)
  const tradeIn = pickNum(o.tradein, 'credit_azn', 'offer', 'current_offer', 'final_offer') ?? pickNum(
    o,
    'tradein_credit_azn',
    'tradein_credit',
    'tradein_azn',
    'trade_in_credit_azn',
    'trade_in_azn',
    'tradein_offer_azn',
  )
  return {
    id: pickStr(o, 'id', 'order_id'),
    status,
    paid: status === 'paid',
    items,
    tradeIn: tradeIn === undefined ? undefined : Math.abs(tradeIn),
    delivery: pickNum(delivery, 'fee_azn', 'fee') ?? pickNum(o, 'delivery_fee_azn', 'delivery_fee', 'delivery_azn'),
    address: pickStr(delivery, 'district', 'name', 'address') ?? pickStr(o, 'delivery_address', 'address', 'district'),
    total: pickNum(o, 'total_azn', 'total', 'amount_azn', 'amount'),
  }
}

export function azn(n: number | undefined): string {
  if (n === undefined) return '—'
  return `${Number.isInteger(n) ? n : n.toFixed(2)} AZN`
}

export function clock(ts: string | number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
