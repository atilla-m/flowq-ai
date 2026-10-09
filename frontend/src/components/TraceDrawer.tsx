import { useEffect, useState, type ComponentType, type SVGProps } from 'react'
import { api } from '../api/client'
import type { TraceEntry } from '../api/types'
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

const PILL: Record<Kind, string> = {
  ok: 'bg-ok-soft text-ok',
  policy: 'bg-warn-soft text-warn',
  mismatch: 'bg-mis-soft text-mis',
  error: 'bg-err-soft text-err',
}
const NODE: Record<Kind, string> = {
  ok: 'border-line bg-surface text-ink-2',
  policy: 'border-warn/40 bg-warn-soft text-warn',
  mismatch: 'border-mis/40 bg-mis-soft text-mis',
  error: 'border-err/40 bg-err-soft text-err',
}
const DETAIL: Record<Kind, string> = {
  ok: 'text-ink-3',
  policy: 'text-warn',
  mismatch: 'text-mis',
  error: 'text-err',
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

function Kpi({ label, value, note, dot }: { label: string; value: string | number; note?: string; dot?: string }) {
  return (
    <div className="min-w-[8.5rem] rounded-xl border border-line bg-surface px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-wide whitespace-nowrap text-ink-3 uppercase">
        {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-lg leading-tight font-semibold text-ink tabular-nums">{value}</span>
        {note && <span className="text-xs text-ink-3 tabular-nums">{note}</span>}
      </div>
    </div>
  )
}

interface Props {
  phone: string
  /** Set by "Reset demo": entries up to `traceUpTo` are hidden and not counted. */
  reset: DemoReset | null
  onShowHistory(): void
}

export function TraceDrawer({ phone, reset, onShowHistory }: Props) {
  const [entries, setEntries] = useState<TraceEntry[]>([])
  // Short screens start with just the latest step so the call and chat keep their room.
  const [size, setSize] = useState<Size>(() =>
    window.innerHeight >= 880 && window.innerWidth >= 1024 ? 'open' : 'compact',
  )
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

  const text = large ? 'text-base' : 'text-sm'
  const listHeight = size === 'tall' ? 'h-[52vh]' : size === 'open' ? 'h-[clamp(7rem,calc(100vh-44rem),12rem)]' : ''
  const iconBtn =
    'flex h-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface px-2 text-ink-2 transition hover:text-ink'

  return (
    <section
      className="mx-4 mb-4 shrink-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
      aria-label="Agent trace"
    >
      {/* Title, KPI cards and controls. Always visible. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <button
          onClick={() => setSize((s) => (s === 'compact' ? 'open' : 'compact'))}
          className="mr-1 flex cursor-pointer items-center gap-2 text-left"
          aria-expanded={size !== 'compact'}
        >
          <ChevronIcon className={`h-4 w-4 text-ink-3 transition ${size === 'compact' ? '-rotate-90' : ''}`} />
          <span>
            <span className="block text-sm font-semibold text-ink">Agent trace</span>
            <span className="block text-xs text-ink-3">What the AI actually did</span>
          </span>
        </button>

        <Kpi
          label="Tool calls"
          value={session.length}
          note={errors ? `${errors} error${errors === 1 ? '' : 's'}` : undefined}
        />
        <Kpi label="Tool latency" value={ms(latencies.at(-1))} note={`median ${ms(median(latencies))}`} />
        <Kpi label="Policy blocks" value={count('policy')} dot="bg-warn" />
        <Kpi label="Mismatches detected" value={mismatches} dot="bg-mis" />

        <div className="ml-auto flex items-center gap-2 text-xs text-ink-3">
          {failed && <span className="text-err">trace unavailable</span>}
          {reset && (
            <span className="whitespace-nowrap">
              since reset {clock(reset.at)} ·{' '}
              <button onClick={onShowHistory} className="cursor-pointer underline hover:text-ink">
                show history
              </button>
            </span>
          )}
          <button
            onClick={toggleLarge}
            aria-pressed={large}
            title="Larger trace text for screen recordings"
            className={`${iconBtn} font-semibold ${large ? 'border-accent/40 bg-accent-soft text-accent-ink' : ''}`}
          >
            <span className="text-[0.6875rem]">A</span>
            <span className="text-sm">A</span>
            <span className="sr-only"> Large text</span>
          </button>
          <button
            onClick={() => setSize((s) => (s === 'tall' ? 'open' : 'tall'))}
            aria-pressed={size === 'tall'}
            title={size === 'tall' ? 'Shrink the trace' : 'Expand the trace'}
            className={`${iconBtn} w-8 ${size === 'tall' ? 'border-accent/40 bg-accent-soft text-accent-ink' : ''}`}
          >
            <ExpandIcon className="h-4 w-4" />
            <span className="sr-only">Expand trace</span>
          </button>
        </div>
      </div>

      {/* Timeline: newest first. Compact shows only the latest step. */}
      <ol className={`scroll-thin overflow-y-auto border-t border-line ${listHeight} ${text}`}>
        {rows.length === 0 && (
          <li className="px-4 py-3 text-sm text-ink-3">
            No tool calls yet. Start a call or send a WhatsApp message — every price, limit and payment check the agent
            makes runs in backend code and shows up here.
          </li>
        )}
        {rows.map(({ e, key, v }, i) => {
          const isOpen = expanded === key
          const Icon = TOOL_ICON[e.tool] ?? WrenchIcon
          return (
            <li key={key} className="relative animate-rise">
              {/* the rail */}
              {rows.length > 1 && (
                <span
                  className={`absolute left-[1.8rem] w-px bg-line ${i === 0 ? 'top-5' : 'top-0'} ${i === rows.length - 1 ? 'h-5' : 'bottom-0'}`}
                  aria-hidden
                />
              )}
              <button
                onClick={() => setExpanded(isOpen ? null : key)}
                aria-expanded={isOpen}
                className="relative flex w-full cursor-pointer items-center gap-3 px-4 py-1.5 text-left hover:bg-surface-2"
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${NODE[v.kind]}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-ink">{v.title}</span>
                  {v.detail && <span className={`ml-2 ${DETAIL[v.kind]}`}>{v.detail}</span>}
                </span>
                <span className="hidden shrink-0 font-mono text-[0.75em] text-ink-3 md:inline">{e.tool}</span>
                <span className="hidden w-[4.5rem] shrink-0 text-center text-[0.75em] text-ink-3 capitalize sm:inline">
                  {e.channel === 'voice' ? 'Voice' : 'WhatsApp'}
                </span>
                <span
                  className={`w-[7.75em] shrink-0 rounded-full px-2 py-0.5 text-center text-[0.8em] font-semibold whitespace-nowrap ${PILL[v.kind]}`}
                >
                  {KIND_LABEL[v.kind]}
                </span>
                <span className="w-[4.5em] shrink-0 text-right text-[0.85em] text-ink-2 tabular-nums">
                  {ms(e.latency_ms ?? 0)}
                </span>
                <span className="hidden w-[4.75em] shrink-0 text-right text-[0.85em] text-ink-3 tabular-nums lg:inline">
                  {time(e.ts)}
                </span>
              </button>
              {isOpen && (
                <div className="grid gap-3 pr-4 pb-3 pl-14 md:grid-cols-2">
                  {(['args', 'result'] as const).map((k) => (
                    <div key={k}>
                      <div className="mb-1 text-[0.6875rem] font-medium tracking-wide text-ink-3 uppercase">
                        {e.tool} · {k}
                      </div>
                      <pre className="scroll-thin max-h-48 overflow-auto rounded-xl border border-line bg-surface-2 p-2.5 font-mono text-xs whitespace-pre-wrap text-ink-2">
                        {JSON.stringify(e[k], null, 2) ?? '—'}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
