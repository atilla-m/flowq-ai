import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { CheckIcon, Logo } from '../components/icons'
import { azn, toOrderView, type OrderView } from '../lib/pick'

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500'

export default function PayPage({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<OrderView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  // "Paid" is never decided here: it is whatever GET /api/orders/{id} reports.
  const paid = order?.paid ?? false

  useEffect(() => {
    let alive = true
    api
      .order(orderId)
      .then((raw) => alive && setOrder(toOrderView(raw)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [orderId])

  const pay = async () => {
    setPaying(true)
    setError(null)
    try {
      // The only call that can mark the order paid. Then read the order back from the backend.
      const res = await api.pay(orderId)
      const fresh = toOrderView(await api.order(orderId))
      setOrder(fresh)
      if (res.status !== 'paid' || !fresh.paid) setError('The backend has not recorded this payment yet.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="min-h-full bg-slate-100 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo className="h-8 w-8" />
            <span className="font-semibold">FlowQ Pay</span>
          </div>
          <span className="rounded-full border border-amber-400 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
            Demo payment · no real charge
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-lg">
          {!order && !error && <p className="animate-pulse p-6 text-sm text-slate-500">Loading order…</p>}

          {!order && error && (
            <div className="p-6">
              <h1 className="font-semibold">Order not found</h1>
              <p className="mt-1 text-sm text-slate-500">
                We couldn’t load order {orderId}. {error}
              </p>
            </div>
          )}

          {order && (
            <>
              <div className="border-b border-slate-200 p-5">
                <div className="flex items-baseline justify-between">
                  <h1 className="font-semibold">Sifariş {order.id ?? orderId}</h1>
                  <span className="text-xs text-slate-500">{paid ? 'paid' : (order.status ?? '').replace(/_/g, ' ')}</span>
                </div>
                <dl className="mt-3 space-y-1.5 text-sm">
                  {order.items.map((it, i) => (
                    <div key={i} className="flex justify-between gap-3">
                      <dt>
                        {it.name}
                        {it.qty > 1 && <span className="text-slate-500"> ×{it.qty}</span>}
                      </dt>
                      <dd className="shrink-0 tabular-nums">{azn(it.price)}</dd>
                    </div>
                  ))}
                  {order.tradeIn !== undefined && order.tradeIn > 0 && (
                    <div className="flex justify-between gap-3 text-emerald-700">
                      <dt>Trade-in</dt>
                      <dd className="shrink-0 tabular-nums">−{azn(order.tradeIn)}</dd>
                    </div>
                  )}
                  {order.delivery !== undefined && (
                    <div className="flex justify-between gap-3">
                      <dt>Çatdırılma{order.address ? ` · ${order.address}` : ''}</dt>
                      <dd className="shrink-0 tabular-nums">{azn(order.delivery)}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-lg font-bold">
                  <span>Cəmi</span>
                  <span className="tabular-nums">{azn(order.total)}</span>
                </div>
              </div>

              {paid ? (
                <div className="flex flex-col items-center p-8 text-center" role="status">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <CheckIcon className="h-7 w-7" />
                  </span>
                  <h2 className="mt-3 text-lg font-semibold">Ödəniş uğurla tamamlandı</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {azn(order.total)} paid (demo). FlowQ has been notified — go back to the chat to see the confirmation.
                  </p>
                  <button
                    onClick={() => {
                      window.close()
                      // window.close() is ignored for tabs the user opened themselves.
                      window.location.href = '/'
                    }}
                    className="mt-5 cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    Back to FlowQ
                  </button>
                </div>
              ) : (
                <form
                  className="space-y-3 p-5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void pay()
                  }}
                >
                  <label className="block text-xs font-medium text-slate-600">
                    Card number
                    <input className={`${field} mt-1 font-mono`} defaultValue="4242 4242 4242 4242" inputMode="numeric" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium text-slate-600">
                      Expiry
                      <input className={`${field} mt-1 font-mono`} defaultValue="12/28" />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      CVC
                      <input className={`${field} mt-1 font-mono`} defaultValue="123" inputMode="numeric" />
                    </label>
                  </div>
                  <label className="block text-xs font-medium text-slate-600">
                    Name on card
                    <input className={`${field} mt-1`} defaultValue="DEMO CUSTOMER" />
                  </label>
                  {error && <p className="text-sm text-red-600">Payment didn’t go through: {error}</p>}
                  <button
                    type="submit"
                    disabled={paying}
                    className="w-full cursor-pointer rounded-lg bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {paying ? 'Processing…' : `Pay ${azn(order.total)}`}
                  </button>
                  <p className="text-center text-xs text-slate-500">
                    This is a mock card form. Card details are not sent anywhere.
                  </p>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
