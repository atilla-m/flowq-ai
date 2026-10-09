import type { Customer } from '../api/types'
import type { LastOrder } from '../hooks/useInbox'
import { azn } from '../lib/pick'
import { deviceFromMemory } from '../lib/traceView'

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.6875rem] font-medium tracking-wide text-ink-3 uppercase">{label}</div>
      <div className="truncate text-sm text-ink">{children}</div>
    </div>
  )
}

interface Props {
  customer: Customer
  /** What the agent remembers, as returned by GET /api/customers/by-phone. */
  memory: string | undefined
  lastOrder: LastOrder | null
  /** Set for a few seconds when an order_update event arrives, e.g. "Order FQ-1 · paid". */
  orderNews: string | null
}

/** Who the agent is talking to and what it already knows about them. */
export function CustomerCard({ customer, memory, lastOrder, orderNews }: Props) {
  // The API gives memory as free text; show a device only when the text says the customer has it.
  const device = deviceFromMemory(memory)
  const paid = lastOrder?.status === 'paid'

  return (
    <section
      aria-label="Customer"
      className="mx-4 mt-3 flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-card"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink">
          {initials(customer.name)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{customer.name}</div>
          <div className="text-xs text-ink-3 tabular-nums">{customer.phone}</div>
        </div>
      </div>

      <Field label="Last device">{device ?? <span className="text-ink-3">Not known yet</span>}</Field>

      {/* An order update briefly lights this field up; the text itself already carries the news. */}
      <div
        className={`-mx-2 -my-1 rounded-lg px-2 py-1 transition-colors duration-500 ${orderNews ? 'bg-accent-soft' : ''}`}
      >
        <span className="sr-only" role="status">
          {orderNews}
        </span>
        <Field label="Last order">
          {lastOrder ? (
            <span className="flex items-center gap-2">
              <span className="tabular-nums">
                {lastOrder.id}
                {lastOrder.total !== undefined && ` · ${azn(lastOrder.total)}`}
              </span>
              {lastOrder.status && (
                <span
                  className={`rounded-full px-2 py-px text-[0.6875rem] font-semibold ${paid ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}
                >
                  {lastOrder.status.replace(/_/g, ' ')}
                </span>
              )}
            </span>
          ) : (
            <span className="text-ink-3">No orders yet</span>
          )}
        </Field>
      </div>

      <div className="min-w-0 flex-1 basis-64" title={memory}>
        <div className="text-[0.6875rem] font-medium tracking-wide text-ink-3 uppercase">Agent memory</div>
        <div className="truncate text-sm text-ink-2">{memory || 'Nothing remembered yet'}</div>
      </div>
    </section>
  )
}
