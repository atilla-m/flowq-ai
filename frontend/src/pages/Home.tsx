import { useCallback, useEffect, useState } from 'react'
import { api, API_BASE, IS_MOCK } from '../api/client'
import { resetMock } from '../api/mock'
import type { Customer, InboxEvent } from '../api/types'
import { ChatPanel } from '../components/ChatPanel'
import { DemoScript } from '../components/DemoScript'
import { ListIcon, Logo } from '../components/icons'
import { HandoffBanner, IncomingCall } from '../components/Overlays'
import { PhonePanel } from '../components/PhonePanel'
import { TraceDrawer } from '../components/TraceDrawer'
import { useInbox } from '../hooks/useInbox'
import { pickStr } from '../lib/pick'
import { useCall } from '../voice/useCall'

const PHONE_KEY = 'flowq-selected-phone'

function Workspace({ customer, showScript, onHideScript }: { customer: Customer; showScript: boolean; onHideScript(): void }) {
  const phone = customer.phone
  const call = useCall(phone)
  const [incoming, setIncoming] = useState(false)
  const [handoff, setHandoff] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [memory, setMemory] = useState<string | undefined>(customer.history_summary)

  const onEvent = useCallback((e: InboxEvent) => {
    if (e.type === 'incoming_callback') setIncoming(true)
    else if (e.type === 'handoff')
      setHandoff(pickStr(e.data, 'summary', 'reason', 'text') ?? 'A human agent is taking over this conversation.')
    else if (e.type === 'order_update') {
      const id = pickStr(e.data, 'order_id', 'id')
      const status = pickStr(e.data, 'status')?.replace(/_/g, ' ')
      setToast(`Order ${id ?? ''} ${status ? `· ${status}` : 'updated'}`)
    }
  }, [])
  const inbox = useInbox(phone, onEvent)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // What the agent remembers about this customer; refreshed after each call since the backend
  // saves a call summary on hang-up.
  const callStatus = call.status
  useEffect(() => {
    if (callStatus !== 'idle' && callStatus !== 'ended') return
    let alive = true
    const t = setTimeout(
      () =>
        api
          .customerByPhone(phone)
          .then((c) => alive && setMemory(c.history_summary))
          .catch(() => {}),
      callStatus === 'ended' ? 1500 : 0,
    )
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [phone, callStatus])

  return (
    <>
      {handoff && <HandoffBanner summary={handoff} onClose={() => setHandoff(null)} />}

      {memory && (
        <p className="mx-4 mt-3 truncate text-xs text-slate-400" title={memory}>
          <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 font-medium text-slate-300">Agent memory</span>
          {memory}
        </p>
      )}

      <main
        className={`grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:overflow-hidden ${
          showScript ? 'lg:grid-cols-[22rem_minmax(0,1fr)_19rem]' : 'lg:grid-cols-[22rem_minmax(0,1fr)]'
        }`}
      >
        <div className="h-[38rem] min-h-0 lg:h-full">
          <PhonePanel customer={customer} call={call} />
        </div>
        <div className="h-[38rem] min-h-0 lg:h-full">
          <ChatPanel
            customer={customer}
            messages={inbox.messages}
            online={inbox.online}
            callActive={call.status === 'connected'}
            onUploadDuringCall={call.notifyUpload}
            addLocal={inbox.addLocal}
            mergeServer={inbox.mergeServer}
          />
        </div>
        {showScript && (
          <div className="h-[30rem] min-h-0 lg:h-full">
            <DemoScript onClose={onHideScript} />
          </div>
        )}
      </main>

      <TraceDrawer phone={phone} />

      {toast && (
        <div className="fixed top-3 left-1/2 z-40 -translate-x-1/2 animate-rise rounded-lg border border-emerald-400/40 bg-slate-900 px-4 py-2 text-sm text-emerald-200 shadow-xl" role="status">
          {toast}
        </div>
      )}

      {incoming && (
        <IncomingCall
          onDecline={() => setIncoming(false)}
          onAccept={() => {
            setIncoming(false)
            call.end()
            call.start()
          }}
        />
      )}
    </>
  )
}

export default function Home() {
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phone, setPhone] = useState<string | null>(() => localStorage.getItem(PHONE_KEY))
  const [showScript, setShowScript] = useState(() => window.innerWidth >= 1280)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    api
      .customers()
      .then((list) => {
        if (!alive) return
        setError(null)
        setCustomers(list)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [attempt])

  const customer = customers?.find((c) => c.phone === phone) ?? customers?.[0]

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 bg-slate-900/70 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <div className="leading-tight">
            <h1 className="bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-lg font-bold text-transparent">
              FlowQ AI
            </h1>
            <p className="hidden text-[11px] text-slate-400 sm:block">Voice + WhatsApp sales agent</p>
          </div>
        </div>

        <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200">
          Industry: <span className="font-semibold text-emerald-300">Gadgets</span>
        </span>
        {IS_MOCK && (
          <button
            onClick={() => {
              resetMock()
              location.reload()
            }}
            title="Mock mode: data is faked in the browser. Click to reset it."
            className="cursor-pointer rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-200"
          >
            Mock data · reset
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <span className="hidden sm:inline">Demo customer</span>
            <select
              value={customer?.phone ?? ''}
              disabled={!customers?.length}
              onChange={(e) => {
                setPhone(e.target.value)
                localStorage.setItem(PHONE_KEY, e.target.value)
              }}
              className="max-w-56 cursor-pointer rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-emerald-400"
            >
              {customers?.map((c) => (
                <option key={c.id} value={c.phone}>
                  {c.name} · {c.phone}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setShowScript((s) => !s)}
            aria-pressed={showScript}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition ${
              showScript ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-slate-700 bg-slate-800 text-slate-200'
            }`}
          >
            <ListIcon className="h-4 w-4" />
            Demo script
          </button>
        </div>
      </header>

      {customer ? (
        <Workspace
          key={customer.phone}
          customer={customer}
          showScript={showScript}
          onHideScript={() => setShowScript(false)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          {error ? (
            <div className="max-w-md space-y-3">
              <h2 className="text-lg font-semibold">Can’t reach the FlowQ backend</h2>
              <p className="text-sm text-slate-400">
                {error}. Start the API at <code className="text-slate-200">{API_BASE}</code>, or run the frontend with{' '}
                <code className="text-slate-200">VITE_MOCK=1</code> to use built-in demo data.
              </p>
              <button
                onClick={() => setAttempt((a) => a + 1)}
                className="cursor-pointer rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                Retry
              </button>
            </div>
          ) : customers ? (
            <p className="text-sm text-slate-400">The backend returned no demo customers.</p>
          ) : (
            <p className="animate-pulse text-sm text-slate-400">Loading customers…</p>
          )}
        </div>
      )}
    </div>
  )
}
