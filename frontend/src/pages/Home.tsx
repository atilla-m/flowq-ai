import { useCallback, useEffect, useState } from 'react'
import { api, API_BASE, IS_MOCK } from '../api/client'
import { resetMock } from '../api/mock'
import type { Customer, InboxEvent } from '../api/types'
import { ChatPanel } from '../components/ChatPanel'
import { CustomerCard } from '../components/CustomerCard'
import { DemoScript } from '../components/DemoScript'
import { ListIcon, Logo, MoonIcon, SunIcon } from '../components/icons'
import { HandoffBanner, IncomingCall } from '../components/Overlays'
import { PhonePanel } from '../components/PhonePanel'
import { TraceDrawer } from '../components/TraceDrawer'
import { useInbox } from '../hooks/useInbox'
import { latestTs, loadReset, saveReset, type DemoReset } from '../lib/demoReset'
import { pickNum, pickStr } from '../lib/pick'
import { useTheme } from '../lib/theme'
import { useCall } from '../voice/useCall'

const PHONE_KEY = 'flowq-selected-phone'

const ghostBtn = 'toolbar-button'

interface WorkspaceProps {
  customer: Customer
  showScript: boolean
  onHideScript(): void
  reset: DemoReset | null
  onShowHistory(): void
}

function Workspace({ customer, showScript, onHideScript, reset, onShowHistory }: WorkspaceProps) {
  const phone = customer.phone
  const call = useCall(phone)
  const [incoming, setIncoming] = useState(false)
  const [handoff, setHandoff] = useState<string | null>(null)
  // Latest order_update, shown for a few seconds as a highlight on the customer card.
  const [toast, setToast] = useState<string | null>(null)
  const [memory, setMemory] = useState<string | undefined>(customer.history_summary)

  const resetTraceUpTo = reset?.traceUpTo
  const onEvent = useCallback(
    (e: InboxEvent) => {
      if (e.type === 'incoming_callback') {
        // A callback's timestamp is when it is due, not when it was asked for. One that was
        // scheduled before "Reset demo" belongs to the previous take, so don't ring for it.
        const due = Date.parse(pickStr(e.data, 'scheduled_at') ?? e.ts)
        const askedAt = due - (pickNum(e.data, 'delay_seconds') ?? 0) * 1000
        if (resetTraceUpTo && askedAt <= Date.parse(resetTraceUpTo) + 1000) return
        setIncoming(true)
      } else if (e.type === 'handoff')
        setHandoff(pickStr(e.data, 'summary', 'reason', 'text') ?? 'A human agent is taking over this conversation.')
      else if (e.type === 'order_update') {
        const id = pickStr(e.data, 'order_id', 'id')
        const status = pickStr(e.data, 'status')?.replace(/_/g, ' ')
        setToast(`Order ${id ?? ''} ${status ? `· ${status}` : 'updated'}`)
      }
    },
    [resetTraceUpTo],
  )
  const inbox = useInbox(phone, onEvent, reset?.messagesUpTo)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // What the agent remembers about this customer. Re-fetched once POST /api/call/end has settled,
  // because that is when the backend has saved the call summary.
  const savedCalls = call.savedCalls
  useEffect(() => {
    let alive = true
    api
      .customerByPhone(phone)
      .then((c) => alive && setMemory(c.history_summary))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [phone, savedCalls])

  return (
    <>
      {handoff && <HandoffBanner summary={handoff} onClose={() => setHandoff(null)} />}

      <CustomerCard customer={customer} memory={memory} lastOrder={inbox.lastOrder} orderNews={toast} />

      <main id="workspace" tabIndex={-1} className="workspace">
        <div className="workspace-call">
          <PhonePanel customer={customer} call={call} />
        </div>
        <div className="workspace-chat">
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
      </main>

      <TraceDrawer phone={phone} reset={reset} onShowHistory={onShowHistory} />

      <DemoScript open={showScript} onClose={onHideScript} />

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
  const [showScript, setShowScript] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [theme, toggleTheme] = useTheme()

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

  // "Reset demo": frontend-only. Remember what the backend already had, hide it, and remount the
  // workspace so transcript, latency, banners, script ticks and stats all start from zero.
  const [resetCount, setResetCount] = useState(0)
  const [resetting, setResetting] = useState(false)
  const reset = customer ? loadReset(customer.phone) : null

  const resetDemo = async () => {
    if (!customer) return
    setResetting(true)
    const now = new Date().toISOString()
    const [inbox, trace] = await Promise.all([
      api.inbox(customer.phone).catch(() => null),
      api.trace(customer.phone).catch(() => null),
    ])
    saveReset(customer.phone, {
      messagesUpTo: inbox ? latestTs(inbox.messages ?? []) : now,
      traceUpTo: trace ? latestTs(trace) : now,
      at: now,
    })
    setResetting(false)
    setResetCount((n) => n + 1)
  }

  const showHistory = () => {
    if (!customer) return
    saveReset(customer.phone, null)
    setResetCount((n) => n + 1)
  }

  const hideScript = useCallback(() => setShowScript(false), [])

  return (
    <div className="app-shell">
      <a href="#workspace" className="skip-link">Skip to conversation</a>
      <header className="app-header">
        <div className="brand">
          <Logo className="brand-mark" />
          <div className="leading-tight">
            <h1 className="brand-name">FlowQ AI</h1>
            <p className="brand-description">Your shop, always answering</p>
          </div>
        </div>

        <span className="industry-label">
          <span className="industry-dot" aria-hidden /> Gadget shop
        </span>
        {IS_MOCK && (
          <button
            onClick={() => {
              resetMock()
              location.reload()
            }}
            title="Mock mode: data is faked in the browser. Click to reset it."
            className="cursor-pointer rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn"
          >
            Mock data · reset
          </button>
        )}

        <div className="header-actions">
          <label className="customer-select">
            <span>Customer</span>
            <select
              name="customer"
              autoComplete="off"
              value={customer?.phone ?? ''}
              disabled={!customers?.length}
              onChange={(e) => {
                setPhone(e.target.value)
                localStorage.setItem(PHONE_KEY, e.target.value)
              }}
              className="customer-picker"
            >
              {customers?.map((c) => (
                <option key={c.id} value={c.phone}>
                  {c.name} · {c.phone}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={resetDemo}
            disabled={!customer || resetting}
            title="Clears this browser's view for the selected customer: chat, call transcript, trace and stats. Backend data and the agent's memory are not changed."
            className={ghostBtn}
          >
            {resetting ? 'Resetting…' : 'Reset demo'}
          </button>
          <button
            onClick={() => setShowScript((s) => !s)}
            aria-pressed={showScript}
            className={`toolbar-button script-button ${showScript ? 'is-active' : ''}`}
          >
            <ListIcon className="h-4 w-4" />
            Demo script
          </button>
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            className="toolbar-button theme-button"
          >
            {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {customer ? (
        <Workspace
          key={`${customer.phone}:${resetCount}`}
          reset={reset}
          onShowHistory={showHistory}
          customer={customer}
          showScript={showScript}
          onHideScript={hideScript}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          {error ? (
            <div className="max-w-md space-y-3 rounded-2xl border border-line bg-surface p-6 shadow-card">
              <h2 className="text-lg font-semibold text-ink">Can’t reach the FlowQ backend</h2>
              <p className="text-sm text-ink-2">{error}</p>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
                <li>
                  Is the API running at <code className="text-ink">{API_BASE}</code>?
                </li>
                <li>
                  The backend only answers browsers on its allowlist: its{' '}
                  <code className="text-ink">ALLOWED_ORIGINS</code> must include{' '}
                  <code className="text-ink">{window.location.origin}</code>.
                </li>
                {window.location.protocol === 'https:' && API_BASE.startsWith('http://') && (
                  <li className="text-warn">
                    This page is on HTTPS but <code>VITE_API_BASE</code> is plain HTTP, which browsers block. Point it
                    at the backend’s https:// URL and rebuild.
                  </li>
                )}
                <li>
                  No backend? Run the frontend with <code className="text-ink">VITE_MOCK=1</code> for built-in demo
                  data.
                </li>
              </ul>
              <button
                onClick={() => setAttempt((a) => a + 1)}
                className="cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-hover"
              >
                Retry
              </button>
            </div>
          ) : customers ? (
            <p className="text-sm text-ink-3">The backend returned no demo customers.</p>
          ) : (
            <p className="animate-pulse text-sm text-ink-3">Loading customers…</p>
          )}
        </div>
      )}
    </div>
  )
}
