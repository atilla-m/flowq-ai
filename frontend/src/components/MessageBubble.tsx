import { useEffect, useState } from 'react'
import { absUrl, api } from '../api/client'
import type { Message } from '../api/types'
import { asObj, azn, clock, pickArr, pickNum, pickStr, toOrderView } from '../lib/pick'
import { CameraIcon, CheckIcon } from './icons'
import { Markdown } from './Markdown'

interface Props {
  message: Message
  onUploadPhotos(): void
}

function Meta({ ts, mine }: { ts: string; mine: boolean }) {
  return (
    <span className="float-right mt-1 ml-3 flex items-center gap-0.5 text-xs leading-none text-wa-meta select-none">
      {clock(ts)}
      {mine && (
        <span className="flex text-sky-500">
          <CheckIcon className="h-3 w-3" />
          <CheckIcon className="-ml-2 h-3 w-3" />
        </span>
      )}
    </span>
  )
}

function ProductCard({ m }: { m: Message }) {
  const d = m.data
  const img = absUrl(m.image_url ?? pickStr(d, 'image_url', 'image'))
  const stock = pickNum(d, 'stock')
  const storage = pickNum(d, 'storage')
  const compatible = pickArr(d, 'compatible_models').filter((x): x is string => typeof x === 'string')
  const variant = [storage ? `${storage} GB` : undefined, pickStr(d, 'color')].filter(Boolean).join(' · ')
  return (
    <div className="message-card product-card">
      {img && <img src={img} alt={pickStr(d, 'name', 'title') ?? 'Product photo'} width={240} height={144} loading="lazy" className="h-36 w-full rounded-md bg-slate-100 object-cover" />}
      <div className="px-1 pt-2">
        <div className="text-sm font-semibold">{pickStr(d, 'name', 'title') ?? m.text ?? 'Product'}</div>
        {variant && <div className="text-xs text-wa-meta">{variant}</div>}
        {compatible.length > 0 && <div className="text-xs text-wa-meta">Fits: {compatible.join(', ')}</div>}
        <div className="mt-0.5 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-wa-ink">{azn(pickNum(d, 'price_azn', 'price'))}</span>
          {stock !== undefined && <span className="text-xs text-wa-meta">In stock: {stock}</span>}
        </div>
      </div>
    </div>
  )
}

function MediaRequest({ m, onUploadPhotos }: { m: Message; onUploadPhotos(): void }) {
  const steps = pickArr(m.data, 'instructions', 'steps', 'required_photos', 'photos').map((s) =>
    typeof s === 'string' ? s : (pickStr(s, 'label', 'text', 'name') ?? ''),
  )
  // The backend sends the instructions as one paragraph (also folded into `text`).
  const body = m.text ?? pickStr(m.data, 'text', 'message', 'instructions')
  return (
    <div className="message-card media-request">
      <div className="flex items-center gap-2 text-sm font-semibold text-wa-ink">
        <CameraIcon className="h-4 w-4" />
        Photo request
      </div>
      {body && <Markdown text={body} className="mt-1.5 text-sm text-wa-ink" />}
      {steps.length > 0 && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-wa-ink">
          {steps.filter(Boolean).map((s, i) => (
            <li key={i}><Markdown text={s} /></li>
          ))}
        </ol>
      )}
      <button
        onClick={onUploadPhotos}
        className="message-action"
      >
        <CameraIcon className="h-4 w-4" />
        Upload photos
      </button>
    </div>
  )
}

function orderIdFrom(d: unknown): string | undefined {
  const direct = pickStr(d, 'order_id', 'id')
  if (direct) return direct
  return pickStr(d, 'url', 'payment_url', 'link')?.match(/\/pay\/([^/?#]+)/)?.[1]
}

function PaymentLink({ m }: { m: Message }) {
  const orderId = orderIdFrom(m.data)
  const [order, setOrder] = useState<{ total?: number; paid: boolean } | null>(null)

  // The link message is a snapshot; the order is the source of truth for amount and paid state.
  // Re-check when the tab regains focus, i.e. when the customer comes back from the pay page.
  useEffect(() => {
    if (!orderId) return
    let alive = true
    const load = () =>
      api
        .order(orderId)
        .then((raw) => {
          const o = toOrderView(raw)
          if (alive) setOrder({ total: o.total, paid: o.paid })
        })
        .catch(() => {})
    load()
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
    }
  }, [orderId])

  const amount = order?.total ?? pickNum(m.data, 'amount_azn', 'amount', 'total_azn', 'total')
  const paid = order?.paid ?? pickStr(m.data, 'status') === 'paid'
  return (
    <div className="message-card payment-card">
      <div className="payment-details">
        <div className="text-xs font-medium text-wa-meta">Payment link</div>
        <div className="payment-amount">{amount === undefined ? '…' : azn(amount)}</div>
        {orderId && <div className="text-xs text-wa-meta">Order {orderId}</div>}
      </div>
      {m.text && <Markdown text={m.text} className="px-1 pt-2 text-sm" />}
      <button
        disabled={!orderId || paid}
        onClick={() => window.open(`/pay/${encodeURIComponent(orderId!)}`, '_blank')}
        className="message-action"
      >
        {paid ? 'Paid ✓' : amount === undefined ? 'Pay' : `Pay ${azn(amount)}`}
      </button>
    </div>
  )
}

function OrderSummary({ m }: { m: Message }) {
  const o = toOrderView(m.data)
  return (
    <div className="message-card order-card">
      {/* A snapshot from when the order was created, so no live status here: the payment card has it. */}
      <div className="border-b border-black/10 px-1 pb-2 text-sm font-semibold">Order {o.id ?? ''}</div>
      <dl className="space-y-1 px-1 py-2 text-sm">
        {o.items.map((it, i) => (
          <div key={i} className="flex justify-between gap-3">
            <dt>
              {it.name}
              {it.qty > 1 && <span className="text-wa-meta"> ×{it.qty}</span>}
            </dt>
            <dd className="shrink-0 tabular-nums">{azn(it.price)}</dd>
          </div>
        ))}
        {o.tradeIn !== undefined && o.tradeIn > 0 && (
          <div className="flex justify-between gap-3 text-wa-ink">
            <dt>Trade-in</dt>
            <dd className="shrink-0 tabular-nums">−{azn(o.tradeIn)}</dd>
          </div>
        )}
        {o.delivery !== undefined && (
          <div className="flex justify-between gap-3">
            <dt>Delivery{o.address ? ` · ${o.address}` : ''}</dt>
            <dd className="shrink-0 tabular-nums">{azn(o.delivery)}</dd>
          </div>
        )}
      </dl>
      <div className="flex justify-between border-t border-black/10 px-1 pt-2 text-sm font-bold">
        <span>Total</span>
        <span className="tabular-nums">{azn(o.total)}</span>
      </div>
    </div>
  )
}

export function MessageBubble({ message: m, onUploadPhotos }: Props) {
  const mine = m.from === 'customer'
  const img = absUrl(m.image_url ?? pickStr(asObj(m.data), 'image_url'))

  let body
  switch (m.type) {
    case 'image':
      body = (
        <>
          {img && <img src={img} alt="Customer photo" width={240} height={240} loading="lazy" className="h-auto max-h-64 max-w-full rounded-md object-contain" />}
          {m.text && <Markdown text={m.text} className="px-1 pt-1.5 text-sm" />}
        </>
      )
      break
    case 'product_card':
      body = <ProductCard m={m} />
      break
    case 'media_request':
      body = <MediaRequest m={m} onUploadPhotos={onUploadPhotos} />
      break
    case 'payment_link':
      body = <PaymentLink m={m} />
      break
    case 'order_summary':
      body = <OrderSummary m={m} />
      break
    default:
      body = <Markdown text={m.text} className="px-1 text-sm" />
  }

  return (
    <div className={`message-row flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`message-bubble ${mine ? 'is-customer' : 'is-agent'}`}
      >
        {body}
        <Meta ts={m.ts} mine={mine} />
      </div>
    </div>
  )
}
