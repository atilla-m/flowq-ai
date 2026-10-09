import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TraceEntry } from '../api/types'
import { newer, type DemoReset } from '../lib/demoReset'
import { asObj, clock, pickArr, pickNum, pickStr } from '../lib/pick'
import { ChevronIcon } from './icons'

const POLL_MS = 2000
const LARGE_KEY = 'flowq-trace-large'

type Kind = 'normal' | 'policy' | 'mismatch' | 'error'

interface Verdict {
  kind: Kind
  /** Short chip text. */
  label?: string
  /** One plain sentence explaining what the backend decided. */
  detail?: string
  /** Number of individual photo-vs-claim mismatches in this entry. */
  mismatches: number
}

/** Classify a tool call by what the backend's rules did, so a viewer can read the row at a glance. */
function judge(e: TraceEntry): Verdict {
  const r = asObj(e.result)

  if (r.error !== undefined && r.error !== null && r.error !== false)
    return { kind: 'error', label: 'Error', detail: pickStr(r, 'message', 'error'), mismatches: 0 }

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
      return { kind: 'mismatch', label: 'Photos ≠ claim', detail, mismatches: items.length }
    }
    if (r.need_retake === true)
      return { kind: 'policy', label: 'Retake required', detail: pickStr(r, 'reason'), mismatches: 0 }
  }

  if (e.tool === 'negotiate_offer' && r.is_final === true) {
    const max = pickNum(r, 'max_offer')
    return {
      kind: 'policy',
      label: 'Limit reached · final offer',
      detail: max === undefined ? undefined : `Backend cap is ${max} AZN (+5%); it will not go higher`,
      mismatches: 0,
    }
  }

  if (e.tool === 'check_payment_status' && r.status !== undefined && r.status !== 'paid')
    return {
      kind: 'policy',
      label: 'Not paid · claim not accepted',
      detail: `Payment status in the database: ${String(r.status)}`,
      mismatches: 0,
    }

  return { kind: 'normal', mismatches: 0 }
}

const ROW: Record<Kind, string> = {
  normal: 'border-l-transparent',
  policy: 'border-l-amber-400 bg-amber-400/10',
  mismatch: 'border-l-fuchsia-400 bg-fuchsia-500/10',
  error: 'border-l-red-500 bg-red-500/10',
}
const CHIP: Record<Kind, string> = {
  normal: '',
  policy: 'bg-amber-400 text-amber-950',
  mismatch: 'bg-fuchsia-400 text-fuchsia-950',
  error: 'bg-red-500 text-white',
}
const TOOL: Record<Kind, string> = {
  normal: 'text-slate-100',
  policy: 'text-amber-200',
  mismatch: 'text-fuchsia-200',
  error: 'text-red-200',
}
const DETAIL: Record<Kind, string> = {
  normal: '',
  policy: 'text-amber-100',
  mismatch: 'text-fuchsia-100',
  error: 'text-red-100',
}

function preview(v: unknown, max = 140): string {
  if (v === undefined || v === null) return '—'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s === '{}') return '—'
  return s.length > max ? `${s.slice(0, max)}…` : s
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

function Stat({ label, value, dot, strong }: { label: string; value: string | number; dot?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      {dot && <span className={`h-2 w-2 shrink-0 self-center rounded-full ${dot}`} />}
      <span className="text-[0.6875rem] tracking-wide text-slate-400 uppercase">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${strong ? 'text-white' : 'text-slate-200'}`}>{value}</span>
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
  const [open, setOpen] = useState(() => window.innerWidth >= 1024)
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
    .map((e, i) => ({ e, key: `${i}-${e.ts}`, v: judge(e) }))
    .filter(({ e }) => !upTo || newer(e.ts, upTo))
  const rows = [...session].reverse() // newest first

  const latencies = session.map(({ e }) => e.latency_ms).filter((n) => typeof n === 'number')
  const count = (k: Kind) => session.filter(({ v }) => v.kind === k).length
  const mismatches = session.reduce((n, { v }) => n + v.mismatches, 0)

  const text = large ? 'text-[0.9375rem]' : 'text-xs'
  const pad = large ? 'py-2.5' : 'py-1.5'
  const cols = large
    ? 'grid-cols-[5.5rem_5.5rem_14rem_minmax(0,1fr)_5rem]'
    : 'grid-cols-[4.5rem_4.75rem_11.5rem_minmax(0,1fr)_4.25rem]'

  return (
    <section className="shrink-0 border-t border-slate-800 bg-slate-900" aria-label="Agent trace">
      {/* Stats strip: always visible, even with the list collapsed */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex cursor-pointer items-center gap-2 text-sm font-semibold"
          aria-expanded={open}
        >
          <ChevronIcon className={`h-4 w-4 text-slate-400 transition ${open ? '' : '-rotate-90'}`} />
          Agent trace
        </button>

        <Stat label="Tool calls" value={session.length} strong />
        <Stat label="Tool latency" value={`last ${ms(latencies.at(-1))} · median ${ms(median(latencies))}`} />
        <Stat label="Policy blocks" value={count('policy')} dot="bg-amber-400" strong={count('policy') > 0} />
        <Stat label="Mismatches detected" value={mismatches} dot="bg-fuchsia-400" strong={mismatches > 0} />
        <Stat label="Errors" value={count('error')} dot="bg-red-500" strong={count('error') > 0} />

        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          {failed && <span className="text-red-400">trace unavailable</span>}
          {reset ? (
            <span className="whitespace-nowrap">
              since reset {clock(reset.at)} ·{' '}
              <button onClick={onShowHistory} className="cursor-pointer underline hover:text-slate-200">
                show history
              </button>
            </span>
          ) : (
            <span className="hidden whitespace-nowrap xl:inline">all history for this customer</span>
          )}
          <button
            onClick={toggleLarge}
            aria-pressed={large}
            title="Larger trace text for screen recordings"
            className={`cursor-pointer rounded-md border px-2 py-1 font-semibold transition ${
              large ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            <span className="text-[0.6875rem]">A</span>
            <span className="text-sm">A</span>
            <span className="sr-only"> Large text</span>
          </button>
        </div>
      </div>

      {open && (
        <div className={`scroll-thin h-[clamp(8rem,21vh,18rem)] overflow-y-auto border-t border-slate-800 font-mono ${text}`}>
          {rows.length === 0 && (
            <p className="p-4 font-sans text-sm text-slate-500">
              No tool calls yet. Start a call or send a WhatsApp message. Every price, limit and payment check the agent
              makes runs in backend code and shows up here.
            </p>
          )}
          {rows.map(({ e, key, v }) => {
            const isOpen = expanded === key
            return (
              <div key={key} className={`border-b border-l-4 border-b-slate-800/70 ${ROW[v.kind]}`}>
                <button
                  onClick={() => setExpanded(isOpen ? null : key)}
                  aria-expanded={isOpen}
                  className={`grid w-full cursor-pointer items-baseline gap-3 px-3 text-left hover:bg-white/5 ${cols} ${pad}`}
                >
                  <span className="text-slate-400">{time(e.ts)}</span>
                  <span
                    className={`w-fit rounded px-1.5 py-px text-[0.8em] uppercase ${
                      e.channel === 'voice' ? 'bg-violet-500/25 text-violet-100' : 'bg-emerald-500/25 text-emerald-100'
                    }`}
                  >
                    {e.channel}
                  </span>
                  <span className={`truncate font-semibold ${TOOL[v.kind]}`}>{e.tool}</span>
                  <span className="min-w-0 truncate">
                    {v.label && (
                      <span className={`mr-2 rounded px-1.5 py-0.5 font-sans text-[0.85em] font-bold ${CHIP[v.kind]}`}>
                        {v.label}
                      </span>
                    )}
                    {v.detail ? (
                      <span className={`font-sans ${DETAIL[v.kind]}`}>{v.detail}</span>
                    ) : (
                      <>
                        <span className="text-slate-400">{preview(e.args, 60)}</span>
                        <span className="text-slate-500"> → </span>
                        <span className="text-slate-200">{preview(e.result)}</span>
                      </>
                    )}
                  </span>
                  <span className="text-right text-slate-300 tabular-nums">{ms(e.latency_ms ?? 0)}</span>
                </button>
                {isOpen && (
                  <div className="grid gap-3 px-3 pb-3 md:grid-cols-2">
                    {(['args', 'result'] as const).map((k) => (
                      <div key={k}>
                        <div className="mb-1 font-sans text-[0.6875rem] tracking-wide text-slate-400 uppercase">{k}</div>
                        <pre className="scroll-thin max-h-48 overflow-auto rounded-md bg-black/40 p-2 whitespace-pre-wrap text-slate-100">
                          {JSON.stringify(e[k], null, 2) ?? '—'}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
