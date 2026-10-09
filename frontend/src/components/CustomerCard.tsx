import type { Customer } from '../api/types'
import type { LastOrder } from '../hooks/useInbox'
import { azn } from '../lib/pick'
import { memoryFacts } from '../lib/memoryFacts'

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`memory-field ${className}`}>
      <dt>{label}</dt>
      <dd className={typeof children === 'string' ? 'memory-value' : undefined} title={typeof children === 'string' ? children : undefined}>{children}</dd>
    </div>
  )
}

interface Props {
  customer: Customer
  /** What the agent remembers, as returned by GET /api/customers/by-phone. */
  memory: string | undefined
  lastOrder: LastOrder | null
  /** Set for a few seconds when an order_update event arrives. */
  orderNews: string | null
}

/** Customer identity and explicit remembered facts, arranged in a flat 2×2 list. */
export function CustomerCard({ customer, memory, lastOrder, orderNews }: Props) {
  const facts = memoryFacts(memory)
  const order = lastOrder ?? facts.order

  return (
    <section aria-label="Customer and agent memory" title={memory} className="customer-memory">
      <dl className="memory-facts">
        <Field label="Customer">
          <span className="customer-identity"><strong>{customer.name}</strong><span>{customer.phone}</span></span>
        </Field>
        <Field label="Last device">{facts.device ?? <span className="text-ink-3">Not known yet</span>}</Field>
        <Field label="District">{facts.district ?? <span className="text-ink-3">Not known yet</span>}</Field>
        <Field label="Last order" className={`memory-order ${orderNews ? 'has-update' : ''}`}>
          <span className="sr-only" role="status">{orderNews}</span>
          {order ? (
            <span className="order-fact">
              <span className="tabular-nums">{order.id}{lastOrder?.total !== undefined && ` · ${azn(lastOrder.total)}`}</span>
              {order.status && <span className="order-status">{order.status.replace(/_/g, ' ')}</span>}
            </span>
          ) : <span className="text-ink-3">No orders yet</span>}
        </Field>
      </dl>
    </section>
  )
}
