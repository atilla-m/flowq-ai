// Turns a raw tool call into what a viewer needs: a plain-English title, a status and, when a
// backend rule stepped in, the reason. Reads tool results defensively; the backend owns their shape.

import type { TraceEntry } from '../api/types'
import { asObj, azn, pickArr, pickNum, pickStr } from './pick'

export type Kind = 'ok' | 'policy' | 'mismatch' | 'error'

export interface TraceView {
  kind: Kind
  /** e.g. "Checked stock: iPhone 15 — 5 in stock" */
  title: string
  /** Extra sentence for policy blocks, mismatches and errors. */
  detail?: string
  /** Number of individual photo-vs-claim mismatches in this entry. */
  mismatches: number
}

export const KIND_LABEL: Record<Kind, string> = {
  ok: 'OK',
  policy: 'Policy block',
  mismatch: 'Mismatch',
  error: 'Error',
}

const ACTION: Record<string, string> = {
  get_customer_history: 'Load customer memory',
  search_inventory: 'Check stock',
  request_media_whatsapp: 'Request photos',
  analyze_device_media: 'Verify photos',
  calculate_tradein: 'Price trade-in',
  negotiate_offer: 'Negotiate',
  get_accessories: 'Find accessories',
  calculate_delivery: 'Delivery fee',
  create_order: 'Create order',
  create_payment_link: 'Payment link',
  check_payment_status: 'Check payment',
  get_order_status: 'Order status',
  schedule_callback: 'Schedule callback',
  handoff_to_human: 'Hand off to a human',
}

function device(o: unknown): string {
  const storage = pickNum(o, 'storage')
  return [pickStr(o, 'name', 'model'), storage ? `${storage} GB` : undefined].filter(Boolean).join(' ')
}

function clip(s: string, max = 90) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function okTitle(tool: string, a: Record<string, unknown>, r: Record<string, unknown>): string {
  switch (tool) {
    case 'get_customer_history':
      return `Loaded customer memory${pickStr(r, 'name') ? `: ${pickStr(r, 'name')}` : ''}`

    case 'search_inventory': {
      const items = pickArr(r, 'items')
      if (!items.length) return `Checked stock: nothing matches “${pickStr(a, 'query') ?? ''}”`
      const stock = pickNum(items[0], 'stock')
      const more = items.length > 1 ? ` (+${items.length - 1} more)` : ''
      return `Checked stock: ${device(items[0])} — ${stock === undefined ? 'available' : stock > 0 ? `${stock} in stock` : 'out of stock'}, ${azn(pickNum(items[0], 'price_azn'))}${more}`
    }

    case 'request_media_whatsapp':
      return 'Sent photo instructions to WhatsApp'

    case 'analyze_device_media': {
      const facts = [
        device(r) || undefined,
        pickNum(r, 'battery_health') !== undefined ? `battery ${pickNum(r, 'battery_health')}%` : undefined,
        r.screen_cracked === true ? 'cracked screen' : r.screen_cracked === false ? 'screen intact' : undefined,
        r.back_cracked === true ? 'cracked back' : undefined,
      ].filter(Boolean)
      return `Verified photos${facts.length ? `: ${facts.join(', ')}` : ''}`
    }

    case 'calculate_tradein': {
      const offer = pickNum(r, 'final_offer', 'current_offer')
      const base = pickNum(r, 'base_offer')
      const cut =
        base !== undefined && offer !== undefined && base > offer
          ? ` (${azn(base)} minus ${azn(base - offer)} deductions)`
          : ''
      return `Priced trade-in: ${azn(offer)}${cut}`
    }

    case 'negotiate_offer':
      return `Raised the offer to ${azn(pickNum(r, 'new_offer'))} (cap ${azn(pickNum(r, 'max_offer'))})`

    case 'get_accessories': {
      const items = pickArr(r, 'items')
      const model = pickStr(r, 'phone_model') ?? pickStr(a, 'phone_model') ?? 'this phone'
      if (!items.length) return `No accessories found for ${model}`
      const first = (pickStr(items[0], 'name') ?? '').replace(/^.*—\s*/, '')
      const more = items.length > 1 ? ` (+${items.length - 1} more)` : ''
      return `Found accessories for ${model}: ${first} ${azn(pickNum(items[0], 'price_azn'))}${more}`
    }

    case 'calculate_delivery':
      if (r.needs_clarification === true) return 'Delivery: asked the customer to clarify the district'
      return `Delivery to ${pickStr(r, 'district') ?? pickStr(a, 'address') ?? 'address'}: ${azn(pickNum(r, 'fee_azn'))}`

    case 'create_order':
      return `Created order ${pickStr(r, 'id', 'order_id') ?? ''}: ${azn(pickNum(r, 'total_azn', 'total'))}`

    case 'create_payment_link':
      return r.status === 'paid'
        ? `Order ${pickStr(r, 'order_id') ?? ''} is already paid`
        : `Sent payment link for ${pickStr(r, 'order_id') ?? 'the order'}`

    case 'check_payment_status':
      return `Payment confirmed for ${pickStr(r, 'order_id') ?? 'the order'}`

    case 'get_order_status': {
      const orders = pickArr(r, 'orders')
      if (Array.isArray(r.orders)) return `Listed ${orders.length} order${orders.length === 1 ? '' : 's'}`
      return `Order ${pickStr(r, 'id', 'order_id') ?? ''}: ${(pickStr(r, 'status') ?? 'unknown').replace(/_/g, ' ')}`
    }

    case 'schedule_callback':
      return `Scheduled a callback in ${pickNum(r, 'delay_seconds') ?? pickNum(a, 'delay_seconds') ?? 15} s`

    case 'handoff_to_human':
      return `Handed off to a human${pickStr(a, 'summary') ? `: ${clip(pickStr(a, 'summary')!, 70)}` : ''}`

    default:
      return tool.replace(/_/g, ' ')
  }
}

export function viewOf(e: TraceEntry): TraceView {
  const a = asObj(e.args)
  const r = asObj(e.result)
  const action = ACTION[e.tool] ?? e.tool.replace(/_/g, ' ')

  if (r.error !== undefined && r.error !== null && r.error !== false)
    return { kind: 'error', title: `${action} failed`, detail: pickStr(r, 'message', 'error'), mismatches: 0 }

  if (e.tool === 'analyze_device_media') {
    const items = pickArr(r, 'mismatches')
    if (items.length) {
      const detail = items
        .map(
          (m) =>
            pickStr(m, 'message') ??
            `${pickStr(m, 'field') ?? 'field'}: claimed ${String(asObj(m).claimed)}, photo shows ${String(asObj(m).observed)}`,
        )
        .join(' · ')
      return { kind: 'mismatch', title: 'Photos contradict what the customer said', detail, mismatches: items.length }
    }
    if (r.need_retake === true)
      return {
        kind: 'policy',
        title: 'Photos not good enough — asked for a retake',
        detail: pickStr(r, 'reason'),
        mismatches: 0,
      }
  }

  if (e.tool === 'negotiate_offer' && r.is_final === true)
    return {
      kind: 'policy',
      title: `Held the line: ${azn(pickNum(r, 'new_offer'))} is the final offer`,
      detail: `Backend cap is ${azn(pickNum(r, 'max_offer'))} (+5%); the agent cannot go higher`,
      mismatches: 0,
    }

  if (e.tool === 'check_payment_status' && r.status !== undefined && r.status !== 'paid')
    return {
      kind: 'policy',
      title: 'Checked payment: not paid — the customer’s claim is not accepted',
      detail: `Payment status in the database: ${String(r.status)}`,
      mismatches: 0,
    }

  return { kind: 'ok', title: okTitle(e.tool, a, r), mismatches: 0 }
}

const DEVICE =
  '(iPhone \\d{1,2}(?: Pro(?: Max)?| Plus| mini)?|Samsung Galaxy [A-Z]\\d{1,3}(?: Ultra| FE)?|Galaxy [A-Z]\\d{1,3}|Xiaomi Redmi Note \\d+|Redmi Note \\d+|Xiaomi \\d+\\w*)(?:\\s+(\\d{2,4})\\s?GB)?'
// Only phrases that say the customer HAS the phone; "wants" or "asked about" is not their device.
const OWNS =
  '(?:uses|using|owns|has|have|bought|trad(?:e|ing)[- ]in(?: offer)?(?: of| for)?)\\s+(?:an?\\s+|the\\s+|their\\s+|my\\s+)?'

/**
 * The customer's own phone as the agent's memory describes it, e.g. "iPhone 13 128 GB".
 * Memory is free text, so this is a best-effort read; it returns nothing rather than guess.
 */
export function deviceFromMemory(summary: string | undefined): string | undefined {
  const m = summary?.match(new RegExp(OWNS + DEVICE, 'i'))
  if (!m) return undefined
  return m[2] ? `${m[1]} ${m[2]} GB` : m[1]
}
