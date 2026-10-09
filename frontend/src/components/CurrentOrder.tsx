import type { Message, TraceEntry } from '../api/types'
import type { LastOrder } from '../hooks/useInbox'
import { currentOrder, ORDER_STEPS } from '../lib/currentOrder'
import { azn } from '../lib/pick'
import { LockIcon } from './icons'

export function CurrentOrder({ entries, messages, lastOrder }: { entries: TraceEntry[]; messages: Message[]; lastOrder: LastOrder | null }) {
  const order = currentOrder(entries, messages, lastOrder)
  const amount = (n: number | undefined) => n !== undefined && n < 0 ? `−${azn(Math.abs(n))}` : azn(n)
  return (
    <section className="current-order" aria-label="Current order">
      <header className="current-order-heading">
        <h3>Current order</h3>
        {order.id && <span role="status" className={`status-pill order-payment ${order.paid ? 'is-paid' : 'is-awaiting'}`}>{order.paid ? 'Paid' : 'Awaiting payment'}</span>}
      </header>
      <ol className="order-progress" aria-label="Order progress">
        {ORDER_STEPS.map((step, i) => <li key={step} className={order.steps[i] ? 'is-complete' : ''} aria-label={`${step}: ${order.steps[i] ? 'complete' : 'pending'}`}><span>{step}</span><i aria-hidden /></li>)}
      </ol>
      {order.lines.length > 0 && <>
        <dl className="current-order-lines scroll-thin">
          {order.lines.map(line => <div key={line.id} className="current-order-line">
            <dt title={line.name}>{line.name}{line.credit && order.finalOffer && <span className="order-final"><LockIcon className="h-3 w-3" />final offer</span>}</dt>
            <dd><span key={line.amount} className="order-amount">{amount(line.amount)}</span></dd>
          </div>)}
        </dl>
        {order.total !== undefined && <dl className="current-order-total"><dt>TOTAL</dt><dd><span key={order.total} className="order-amount">{azn(order.total)}</span></dd></dl>}
      </>}
    </section>
  )
}
