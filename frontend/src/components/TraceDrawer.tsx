import { useEffect, useState, type ComponentType, type SVGProps } from 'react'
import { api } from '../api/client'
import type { Message, TraceEntry } from '../api/types'
import type { LastOrder } from '../hooks/useInbox'
import { CurrentOrder } from './CurrentOrder'
import { newer, type DemoReset } from '../lib/demoReset'
import { clock } from '../lib/pick'
import { KIND_LABEL, viewOf, type Kind } from '../lib/traceView'
import {
  BagIcon,
  CameraIcon,
  CardIcon,
  ChevronIcon,
  ClockIcon,
  ExpandIcon,
  PackageIcon,
  ReceiptIcon,
  ScanIcon,
  SearchIcon,
  ShieldIcon,
  TagIcon,
  TrendIcon,
  TruckIcon,
  UserIcon,
  WrenchIcon,
} from './icons'

const POLL_MS = 2000
const LARGE_KEY = 'flowq-trace-large'

type Size = 'compact' | 'open' | 'tall'

const TOOL_ICON: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  get_customer_history: UserIcon,
  search_inventory: SearchIcon,
  request_media_whatsapp: CameraIcon,
  analyze_device_media: ScanIcon,
  calculate_tradein: TagIcon,
  negotiate_offer: TrendIcon,
  get_accessories: BagIcon,
  calculate_delivery: TruckIcon,
  create_order: ReceiptIcon,
  create_payment_link: CardIcon,
  check_payment_status: ShieldIcon,
  get_order_status: PackageIcon,
  schedule_callback: ClockIcon,
  handoff_to_human: UserIcon,
}

const STATUS: Record<Kind, string> = {
  ok: 'status-ok',
  policy: 'status-policy',
  mismatch: 'status-mismatch',
  error: 'status-error',
}
function time(ts: string) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false })
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const ms = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n)} ms`)

function Kpi({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="trace-metric" title={note}>
      <span className="trace-metric-label">{label}</span>
      <strong className="trace-metric-value">{value}</strong>
      {note && <span className="trace-metric-note">{note}</span>}
    </div>
  )
}

interface Props {
  phone: string
  messages: Message[]
  lastOrder: LastOrder | null
  /** Set by "Reset demo": entries up to `traceUpTo` are hidden and not counted. */
  reset: DemoReset | null
  onShowHistory(): void
}

export function TraceDrawer({ phone, messages, lastOrder, reset, onShowHistory }: Props) {
  const [entries, setEntries] = useState<TraceEntry[]>([])
  // A dedicated console can show the full timeline at every desktop height.
  const [size, setSize] = useState<Size>('open')
  const [large, setLarge] = useState(() => {
    try {
      return localStorage.getItem(LARGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const res = await api.trace(phone)
        if (!alive) return
        setEntries(Array.isArray(res) ? res : [])
        setFailed(false)
      } catch {
        if (alive) setFailed(true)
      }
      if (alive) timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [phone])

  const toggleLarge = () =>
    setLarge((v) => {
      try {
        localStorage.setItem(LARGE_KEY, v ? '0' : '1')
      } catch {
        // preference just won't persist
      }
      return !v
    })

  // This session = everything since the last "Reset demo" (or all history if never reset).
  const upTo = reset?.traceUpTo
  const session = entries
    .map((e, i) => ({ e, key: `${i}-${e.ts}`, v: viewOf(e) }))
    .filter(({ e }) => !upTo || newer(e.ts, upTo))
  const newestFirst = [...session].reverse()
  const rows = size === 'compact' ? newestFirst.slice(0, 1) : newestFirst

  const latencies = session.map(({ e }) => e.latency_ms).filter((n) => typeof n === 'number')
  const count = (k: Kind) => session.filter(({ v }) => v.kind === k).length
  const mismatches = session.reduce((n, { v }) => n + v.mismatches, 0)
  const errors = count('error')

  const text = large ? 'trace-large' : ''
  const listHeight = `trace-list-${size}`
  const iconBtn = 'console-icon-button'

  return (
    <section
      className={`trace-panel ${size === 'tall' ? 'is-tall' : ''}`}
      aria-label="Agent trace"
    >
      <div className="trace-kpis" aria-label="Agent metrics">
        <Kpi label="Tool calls" value={session.length} note={errors ? `${errors} error${errors === 1 ? '' : 's'}` : undefined} />
        <Kpi label="Median latency" value={ms(median(latencies))} note={latencies.length ? `Latest ${ms(latencies.at(-1))}` : undefined} />
        <Kpi label="Policy blocks" value={count('policy')} />
        <Kpi label="Mismatches" value={mismatches} />
      </div>
      <CurrentOrder entries={session.map(({ e }) => e)} messages={messages} lastOrder={lastOrder} />
      <div className="trace-header">
        <button
          onClick={() => setSize((s) => (s === 'compact' ? 'open' : 'compact'))}
          className="trace-toggle"
          aria-expanded={size !== 'compact'}
        >
          <ChevronIcon className={`h-4 w-4 ${size === 'compact' ? '-rotate-90' : ''}`} />
          <h3>Live actions</h3>
          <span className="action-count">{session.length}</span>
        </button>
        <div className="trace-controls">
          {failed && <span className="status-pill bg-err-soft text-err">Unavailable</span>}
          <button
            onClick={toggleLarge}
            aria-pressed={large}
            title="Larger trace text for screen recordings"
            className={`${iconBtn} ${large ? 'is-active' : ''}`}
          >
            <span className="text-xs">A</span><span className="text-sm">A</span>
            <span className="sr-only"> Large text</span>
          </button>
          <button
            onClick={() => setSize((s) => (s === 'tall' ? 'open' : 'tall'))}
            aria-label={size === 'tall' ? 'Shrink trace' : 'Expand trace'}
            aria-pressed={size === 'tall'}
            title={size === 'tall' ? 'Shrink the trace' : 'Expand the trace'}
            className={`${iconBtn} ${size === 'tall' ? 'is-active' : ''}`}
          >
            <ExpandIcon className="h-4 w-4" />
            <span className="sr-only">Expand trace</span>
          </button>
        </div>
        {reset && (
          <span className="trace-reset">
            since reset {clock(reset.at)} ·{' '}
            <button onClick={onShowHistory} className="cursor-pointer underline hover:text-ink">
              show history
            </button>
          </span>
        )}
      </div>

      {/* Timeline: newest first. Compact shows only the latest step. */}
      <ol className={`trace-list scroll-thin ${listHeight} ${text}`} aria-label="Agent action timeline">
        {rows.length === 0 && (
          <li className="trace-empty">
            <span className="waiting-dot" aria-hidden />Waiting for a call or message
          </li>
        )}
        {rows.map(({ e, key, v }, i) => {
          const isOpen = expanded === key
          const Icon = TOOL_ICON[e.tool] ?? WrenchIcon
          return (
            <li key={key} className={`trace-entry ${i === 0 ? 'is-newest' : ''}`}>
              <button
                onClick={() => setExpanded(isOpen ? null : key)}
                aria-expanded={isOpen}
                title={`${e.tool} · ${e.channel === 'voice' ? 'Voice' : 'WhatsApp'} · ${KIND_LABEL[v.kind]} · ${ms(e.latency_ms ?? 0)} · ${time(e.ts)}${v.detail ? ` · ${v.detail}` : ''}`}
                className="trace-action"
              >
                <span className="trace-node" aria-hidden />
                <span className="trace-action-body">
                  <span className="trace-title"><Icon className="h-3.5 w-3.5" />{v.title}</span>
                  <span className="trace-action-meta">
                    <span className={`status-indicator ${STATUS[v.kind]}`}><i aria-hidden />{KIND_LABEL[v.kind]}</span>
                    <span className="trace-latency">{ms(e.latency_ms ?? 0)}</span>
                  </span>
                </span>
                <ChevronIcon className={`h-4 w-4 shrink-0 text-ink-3 ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="trace-details">
                  <dl className="trace-metadata">
                    <div><dt>Tool</dt><dd className="tool-name" translate="no">{e.tool}</dd></div>
                    <div><dt>Channel</dt><dd>{e.channel === 'voice' ? 'Voice' : 'WhatsApp'}</dd></div>
                    <div><dt>Result</dt><dd><span className={`status-indicator ${STATUS[v.kind]}`}><i aria-hidden />{KIND_LABEL[v.kind]}</span></dd></div>
                    <div><dt>Latency</dt><dd>{ms(e.latency_ms ?? 0)}</dd></div>
                    <div><dt>Time</dt><dd>{time(e.ts)}</dd></div>
                  </dl>
                  {v.detail && <p className="trace-detail-text">{v.detail}</p>}
                  <div className="trace-payloads">
                    {(['args', 'result'] as const).map((k) => (
                      <div key={k}>
                        <div className="mb-1 text-xs font-medium text-ink-3">{k === 'args' ? 'Arguments' : 'Result'}</div>
                        <pre className="trace-json scroll-thin">{JSON.stringify(e[k], null, 2) ?? '—'}</pre>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
