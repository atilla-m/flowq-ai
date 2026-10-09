import type { Message, TraceEntry } from '../api/types'
import type { LastOrder } from '../hooks/useInbox'
import { asObj, pickArr, pickNum, pickStr, toOrderView } from './pick'

export const ORDER_STEPS = ['Product', 'Trade-in', 'Offer', 'Delivery', 'Payment'] as const
export interface CurrentOrderLine { id: string; name: string; amount?: number; credit?: boolean }
export interface CurrentOrderView {
  id?: string
  steps: boolean[]
  lines: CurrentOrderLine[]
  total?: number
  finalOffer: boolean
  paid: boolean
}

function itemLines(items: unknown[]): CurrentOrderLine[] {
  return items.map((item, index) => {
    const quantity = pickNum(item, 'quantity', 'qty') ?? 1
    const unit = pickNum(item, 'price_azn', 'unit_price_azn', 'price', 'amount')
    const amount = pickNum(item, 'line_total_azn', 'total_azn') ?? (unit === undefined ? undefined : unit * quantity)
    const name = [pickStr(item, 'name', 'title', 'sku'), pickNum(item, 'storage') ? `${pickNum(item, 'storage')} GB` : undefined, pickStr(item, 'color', 'variant')].filter(Boolean).join(' · ') || 'Item'
    return { id: `item-${pickStr(item, 'sku', 'id') ?? index}`, name: quantity > 1 ? `${name} ×${quantity}` : name, amount }
  })
}

/** Display-only projection of already received tool results and structured inbox records. */
export function currentOrder(entries: TraceEntry[], messages: Message[], lastOrder: LastOrder | null): CurrentOrderView {
  const steps = ORDER_STEPS.map(() => false)
  let items: CurrentOrderLine[] = []
  let credit: number | undefined
  let delivery: number | undefined
  let total: number | undefined
  let id: string | undefined
  let quoteId: string | undefined
  let finalOffer = false
  let draftFinal = false
  const paidOrders = new Set<string>()
  const events = [
    ...entries.map(e => ({ ts: e.ts, tool: e.tool, result: e.result, args: e.args })),
    ...messages.filter(m => m.from === 'agent' && (m.type === 'order_summary' || m.type === 'product_card')).map(m => ({ ts: m.ts, tool: m.type, result: m.data, args: undefined })),
  ].sort((a, b) => (Date.parse(a.ts) - Date.parse(b.ts)) || a.ts.localeCompare(b.ts))

  for (const event of events) {
    const r = asObj(event.result)
    if (!Object.keys(r).length || r.error || r.ok === false || r.need_retake || r.needs_clarification) continue
    if (event.tool === 'search_inventory' || event.tool === 'product_card') {
      if (event.tool === 'search_inventory') steps[0] = true
      const candidates = event.tool === 'product_card' ? [r] : pickArr(r, 'items', 'products', 'results')
      const product = candidates.find(item => pickStr(item, 'kind') !== 'accessory' && !pickArr(item, 'compatible_models').length)
      if (!id && product) items = itemLines([product])
    } else if (event.tool === 'calculate_tradein') {
      const offer = pickNum(r, 'current_offer', 'final_offer', 'offer', 'credit_azn')
      if (offer === undefined) continue
      steps[1] = true
      quoteId = pickStr(r, 'quote_id')
      draftFinal = false
      if (!id) { credit = Math.abs(offer); finalOffer = false }
    } else if (event.tool === 'negotiate_offer') {
      const offer = pickNum(r, 'new_offer', 'current_offer', 'offer', 'final_offer')
      if (offer === undefined) continue
      steps[2] = true
      if (!quoteId || !pickStr(r, 'quote_id') || quoteId === pickStr(r, 'quote_id')) {
        draftFinal = r.is_final === true
        if (!id) { credit = Math.abs(offer); finalOffer = draftFinal }
      }
    } else if (event.tool === 'calculate_delivery') {
      const fee = pickNum(r, 'fee_azn', 'fee', 'delivery_fee_azn')
      if (fee === undefined) continue
      steps[3] = true
      if (!id) delivery = fee
    } else if (event.tool === 'create_order' || event.tool === 'order_summary') {
      const o = toOrderView(r)
      if (!o.id || !o.items.length) continue
      const raw = asObj(r.order ?? r)
      const attachedQuote = pickStr(raw.tradein, 'quote_id')
      if (id && id !== o.id) {
        // A later order must not inherit a previous order's quote lock or payment confirmation.
        steps[4] = false
      }
      if (id !== o.id) finalOffer = draftFinal && (!attachedQuote || attachedQuote === quoteId)
      if (o.tradeIn === undefined) finalOffer = false
      id = o.id
      steps[0] = true
      items = itemLines(pickArr(raw, 'items', 'lines', 'line_items'))
      credit = o.tradeIn
      delivery = o.delivery
      total = o.total
      if (o.paid) paidOrders.add(id)
    } else if (event.tool === 'check_payment_status' || event.tool === 'pay') {
      const orderId = pickStr(r, 'order_id', 'id') ?? pickStr(event.args, 'order_id', 'id')
      if (!id || orderId !== id) continue
      steps[4] = true
      if (r.status === 'paid') paidOrders.add(id)
    }
  }

  const paid = !!id && (paidOrders.has(id) || (lastOrder?.id === id && lastOrder.status === 'paid'))
  if (paid) steps[4] = true
  const lines = [...items]
  if (credit !== undefined) lines.splice(Math.min(1, lines.length), 0, { id: 'trade-in', name: 'Trade-in credit', amount: -credit, credit: true })
  if (delivery !== undefined) lines.push({ id: 'delivery', name: 'Delivery', amount: delivery })
  if (total === undefined && lines.length && lines.every(line => line.amount !== undefined)) total = lines.reduce((sum, line) => sum + Math.round(line.amount! * 100), 0) / 100
  return { id, steps, lines, total, finalOffer, paid }
}
