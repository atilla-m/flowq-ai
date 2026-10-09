import { useEffect, useRef } from 'react'
import { IS_MOCK } from '../api/client'
import type { Customer } from '../api/types'
import { mmss } from '../lib/pick'
import type { CallState } from '../voice/useCall'
import { HangupIcon, Logo, MicIcon, PhoneIcon, WrenchIcon } from './icons'

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

const ms = (n: number | undefined) => (n === undefined ? '—' : `${n} ms`)

function LatencyMeter({ samples }: { samples: number[] }) {
  const last = samples.at(-1)
  const tone = last === undefined ? 'text-slate-400' : last < 1200 ? 'text-emerald-400' : 'text-amber-400'
  return (
    <div
      className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-xs"
      title="Time from the customer finishing speaking to the first agent audio, measured in this browser. Includes the VAD silence window; turns with a tool call include the tool round-trip."
    >
      <span className="text-slate-400">Latency</span>
      <span className="flex gap-3 whitespace-nowrap tabular-nums">
        <span>
          <span className="text-slate-500">last </span>
          <span className={`font-semibold ${tone}`}>{ms(last)}</span>
        </span>
        <span>
          <span className="text-slate-500">median </span>
          <span className="font-semibold text-slate-200">{ms(median(samples))}</span>
        </span>
        <span className="text-slate-500">n={samples.length}</span>
      </span>
    </div>
  )
}

function MicMeter({ level, active }: { level: number; active: boolean }) {
  const bars = 14
  return (
    <div className="flex items-center gap-2" aria-label="Microphone level">
      <MicIcon className={`h-4 w-4 ${active ? 'text-emerald-400' : 'text-slate-500'}`} />
      <div className="flex h-5 flex-1 items-center gap-[3px]">
        {Array.from({ length: bars }, (_, i) => {
          const on = level * bars > i
          return (
            <span
              key={i}
              className={`w-full rounded-full transition-all duration-75 ${on ? 'bg-emerald-400' : 'bg-white/10'}`}
              style={{ height: on ? `${40 + (i / bars) * 60}%` : '25%' }}
            />
          )
        })}
      </div>
    </div>
  )
}

const END_TEXT: Record<string, string> = {
  callback: 'Call ended — FlowQ will call you back',
  error: 'Call ended unexpectedly',
  remote: 'Call ended by FlowQ',
  user: 'Call ended',
}

export function PhonePanel({ customer, call }: { customer: Customer; call: CallState }) {
  const { status, lines } = call
  const bottom = useRef<HTMLDivElement>(null)
  const lastText = lines.at(-1)?.text

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lines.length, lastText])

  const statusText =
    status === 'ringing'
      ? 'Calling…'
      : status === 'connected'
        ? call.agentSpeaking
          ? 'FlowQ is speaking'
          : call.userSpeaking
            ? 'Listening…'
            : 'Connected'
        : status === 'ended'
          ? END_TEXT[call.endReason ?? 'user']
          : 'AI sales agent · answers instantly'

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-sm flex-col rounded-[2.2rem] border-[6px] border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl">
      <div className="mx-auto mt-2 h-1.5 w-20 shrink-0 rounded-full bg-slate-800" />

      <header className="flex shrink-0 flex-col items-center px-5 pt-3 pb-2 text-center">
        <div className="relative">
          {status === 'ringing' && (
            <span className="absolute inset-0 animate-ring rounded-full bg-emerald-400/40" />
          )}
          {status === 'connected' && call.agentSpeaking && (
            <span className="absolute inset-0 animate-ring rounded-full bg-cyan-400/40" />
          )}
          <Logo className="relative h-11 w-11 rounded-full ring-2 ring-white/10" />
        </div>
        <h2 className="mt-1.5 text-sm font-semibold">FlowQ Store</h2>
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === 'connected' ? 'bg-emerald-400' : status === 'ringing' ? 'animate-pulse bg-amber-400' : 'bg-slate-600'
            }`}
          />
          {statusText}
          {status !== 'idle' && status !== 'ringing' && (
            <span className="font-mono text-slate-300 tabular-nums">{mmss(call.seconds)}</span>
          )}
        </p>
      </header>

      <div className="scroll-thin mx-3 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl bg-black/25 p-3">
        {call.error && (
          <div className="sticky top-0 z-10 rounded-xl border border-red-500/40 bg-red-950 p-3 text-xs text-red-100" role="alert">
            <p className="font-semibold">
              {call.error.kind === 'mic' ? 'Microphone unavailable' : 'Voice call unavailable'}
            </p>
            <p className="mt-1 text-red-200/90">{call.error.message}</p>
            <p className="mt-1.5 text-slate-300">You can keep going in the WhatsApp panel — it works without voice.</p>
            <button onClick={call.dismissError} className="mt-1.5 cursor-pointer text-red-200 underline">
              Dismiss
            </button>
          </div>
        )}

        {lines.length === 0 && !call.error && (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-xs text-slate-500">
            {status === 'idle' ? (
              <>
                <p className="text-sm text-slate-300">Call as {customer.name}</p>
                <p>Speak Azerbaijani or Russian. The live transcript appears here.</p>
                {IS_MOCK && <p className="mt-2 text-amber-400/80">Mock mode: the call is a scripted simulation.</p>}
              </>
            ) : (
              <p>{status === 'ringing' ? 'Connecting to the agent…' : 'Say something — FlowQ is listening.'}</p>
            )}
          </div>
        )}
        {lines.map((l) =>
          l.role === 'tool' ? (
            <div key={l.id} className="flex animate-rise justify-center">
              <span className="flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2.5 py-1 font-mono text-[11px] text-violet-200">
                <WrenchIcon className={`h-3 w-3 ${l.pending ? 'animate-spin' : ''}`} />
                {l.text}
              </span>
            </div>
          ) : (
            <div key={l.id} className={`flex animate-rise ${l.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug ${
                  l.role === 'customer'
                    ? 'rounded-br-sm bg-emerald-600 text-white'
                    : 'rounded-bl-sm bg-slate-700/80 text-slate-100'
                }`}
              >
                {l.text || <span className="opacity-60">…</span>}
                {l.interrupted && <span className="ml-1 text-[11px] text-amber-300">— interrupted</span>}
              </div>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      <footer className="shrink-0 space-y-2.5 px-4 pt-3 pb-4">
        <MicMeter level={call.micLevel} active={status === 'connected'} />
        <LatencyMeter samples={call.latencies} />

        {status === 'connected' || status === 'ringing' ? (
          <button
            onClick={call.end}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-red-600 py-3 text-sm font-semibold text-white transition hover:bg-red-500"
          >
            <HangupIcon className="h-5 w-5" />
            End call
          </button>
        ) : (
          <button
            onClick={call.start}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-emerald-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            <PhoneIcon className="h-5 w-5" />
            {status === 'ended' ? 'Call again' : 'Call FlowQ'}
          </button>
        )}
      </footer>
    </section>
  )
}
