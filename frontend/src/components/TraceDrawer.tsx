import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TraceEntry } from '../api/types'
import { asObj, pickArr, pickStr } from '../lib/pick'
import { ChevronIcon, ShieldIcon } from './icons'

const POLL_MS = 2000

/** Backend-enforced policy outcomes worth pointing a judge at. */
function policyFlag(e: TraceEntry): string | null {
  const r = asObj(e.result)
  if (e.tool === 'negotiate_offer' && r.is_final === true) return 'Limit reached · final offer'
  if (e.tool === 'analyze_device_media') {
    const n = pickArr(r, 'mismatches').length
    if (n) return `Photos contradict claim (${n})`
  }
  if (e.tool === 'check_payment_status' && (r.paid === false || (r.status !== undefined && r.status !== 'paid')))
    return 'Not paid · claim not accepted'
  if (r.blocked === true || r.policy_block !== undefined) return pickStr(r, 'reason', 'policy_block') ?? 'Policy block'
  return null
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

export function TraceDrawer({ phone }: { phone: string }) {
  const [entries, setEntries] = useState<TraceEntry[]>([])
  const [open, setOpen] = useState(() => window.innerWidth >= 1024)
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

  // Newest first; key by original position so rows stay stable as the list grows.
  const rows = entries.map((e, i) => ({ e, key: `${i}-${e.ts}`, flag: policyFlag(e) })).reverse()
  const flagged = rows.filter((r) => r.flag).length

  return (
    <section className="shrink-0 border-t border-slate-800 bg-slate-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm"
        aria-expanded={open}
      >
        <ChevronIcon className={`h-4 w-4 text-slate-400 transition ${open ? '' : '-rotate-90'}`} />
        <span className="font-semibold">Agent trace</span>
        <span className="text-xs text-slate-400">
          {entries.length} tool call{entries.length === 1 ? '' : 's'} · every price, limit and payment check runs in backend code
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs">
          {failed && <span className="text-red-400">trace unavailable</span>}
          {flagged > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
              <ShieldIcon className="h-3 w-3" />
              {flagged} policy block{flagged === 1 ? '' : 's'}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="scroll-thin h-44 overflow-y-auto border-t border-slate-800 font-mono text-xs">
          {rows.length === 0 && (
            <p className="p-4 font-sans text-slate-500">
              No tool calls yet. Start a call or send a WhatsApp message — each step the agent takes shows up here.
            </p>
          )}
          {rows.map(({ e, key, flag }) => {
            const isOpen = expanded === key
            return (
              <div
                key={key}
                className={`border-b border-slate-800/70 ${flag ? 'border-l-2 border-l-amber-400 bg-amber-500/10' : 'border-l-2 border-l-transparent'}`}
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : key)}
                  className="grid w-full cursor-pointer grid-cols-[4.5rem_4.5rem_11rem_1fr_4rem] items-baseline gap-3 px-4 py-1.5 text-left hover:bg-white/5"
                >
                  <span className="text-slate-500">{time(e.ts)}</span>
                  <span
                    className={`w-fit rounded px-1.5 py-px text-[10px] uppercase ${
                      e.channel === 'voice' ? 'bg-violet-500/20 text-violet-200' : 'bg-emerald-500/20 text-emerald-200'
                    }`}
                  >
                    {e.channel}
                  </span>
                  <span className={`truncate font-semibold ${flag ? 'text-amber-200' : 'text-slate-100'}`}>{e.tool}</span>
                  <span className="min-w-0 truncate text-slate-400">
                    {flag && (
                      <span className="mr-2 rounded bg-amber-400 px-1.5 py-px font-sans text-[10px] font-semibold text-amber-950">
                        {flag}
                      </span>
                    )}
                    <span className="text-slate-500">{preview(e.args, 60)}</span>
                    <span className="text-slate-600"> → </span>
                    {preview(e.result)}
                  </span>
                  <span className="text-right text-slate-400 tabular-nums">{Math.round(e.latency_ms ?? 0)} ms</span>
                </button>
                {isOpen && (
                  <div className="grid gap-3 px-4 pb-3 md:grid-cols-2">
                    {(['args', 'result'] as const).map((k) => (
                      <div key={k}>
                        <div className="mb-1 font-sans text-[10px] tracking-wide text-slate-500 uppercase">{k}</div>
                        <pre className="scroll-thin max-h-48 overflow-auto rounded-md bg-black/40 p-2 whitespace-pre-wrap text-slate-200">
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
