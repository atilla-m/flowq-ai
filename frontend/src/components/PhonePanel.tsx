import { useEffect, useRef } from 'react'
import { IS_MOCK } from '../api/client'
import type { Customer } from '../api/types'
import { mmss } from '../lib/pick'
import type { CallState } from '../voice/useCall'
import { BoltIcon, HangupIcon, Logo, MicIcon, PhoneIcon, WrenchIcon } from './icons'

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

const ms = (n: number | undefined) => (n === undefined ? '—' : `${n} ms`)

function LatencyChip({ samples }: { samples: number[] }) {
  const last = samples.at(-1)
  const tone = last === undefined ? 'text-ink' : last < 1200 ? 'text-ok' : 'text-warn'
  return (
    <div
      className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs whitespace-nowrap tabular-nums"
      title="Time from the customer finishing speaking to the first agent audio, measured in this browser. Includes the voice-activity silence window; turns with a tool call include the tool round-trip."
    >
      <BoltIcon className="h-3.5 w-3.5 text-accent" />
      <span className="text-ink-3">Latency</span>
      <span className={`font-semibold ${tone}`}>{ms(last)}</span>
      <span className="text-ink-3">median</span>
      <span className="font-semibold text-ink">{ms(median(samples))}</span>
      <span className="text-ink-3">n={samples.length}</span>
    </div>
  )
}

/**
 * One waveform for both directions: while the agent speaks the bars animate on their own; while
 * the customer speaks they follow the live microphone level.
 */
function Waveform({ level, agentSpeaking, live }: { level: number; agentSpeaking: boolean; live: boolean }) {
  const bars = 28
  return (
    <div className="flex items-center gap-2.5 px-1" aria-label="Microphone level">
      <MicIcon className={`h-4 w-4 shrink-0 ${live ? 'text-emerald-300' : 'text-white/30'}`} />
      <div className="flex h-8 flex-1 items-center justify-between">
        {Array.from({ length: bars }, (_, i) => {
          // A soft bell curve so the wave is tallest in the middle.
          const shape = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / bars)
          if (agentSpeaking)
            return (
              <span
                key={i}
                className="w-[3px] origin-center animate-wave rounded-full bg-indigo-300"
                style={{ height: `${shape * 100}%`, animationDelay: `${(i % 7) * -0.13}s` }}
              />
            )
          const h = live ? Math.max(0.12, Math.min(1, level * 1.6) * shape) : 0.12
          return (
            <span
              key={i}
              className={`w-[3px] rounded-full transition-[height] duration-100 ${live && level > 0.06 ? 'bg-emerald-300' : 'bg-white/20'}`}
              style={{ height: `${h * 100}%` }}
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
  const live = status === 'connected'
  const active = live || status === 'ringing'

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lines.length, lastText])

  const statusText =
    status === 'ringing'
      ? 'Calling…'
      : live
        ? call.agentSpeaking
          ? 'FlowQ is speaking'
          : call.userSpeaking
            ? 'Listening…'
            : 'Connected'
        : status === 'ended'
          ? END_TEXT[call.endReason ?? 'user']
          : 'Ready to call'

  const dot = live ? 'bg-ok' : status === 'ringing' ? 'animate-pulse bg-warn' : 'bg-ink-3/50'

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Voice call</h2>
          <p className="flex items-center gap-1.5 text-xs text-ink-3">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            {statusText}
            {(live || status === 'ended') && (
              <span className="font-mono text-ink-2 tabular-nums">{mmss(call.seconds)}</span>
            )}
          </p>
        </div>
        <LatencyChip samples={call.latencies} />
      </header>

      <div className="stage flex min-h-0 flex-1 items-center justify-center p-4 [@media(max-height:820px)]:p-2.5">
        {/* Phone body */}
        <div className="relative flex h-full max-h-[44rem] w-full max-w-[20.5rem] flex-col rounded-[2.75rem] bg-[#0b0d12] p-2 shadow-pop ring-1 ring-black/10 dark:ring-white/15">
          <span className="absolute top-24 -left-[3px] h-9 w-[3px] rounded-l bg-[#0b0d12]" aria-hidden />
          <span className="absolute top-36 -left-[3px] h-14 w-[3px] rounded-l bg-[#0b0d12]" aria-hidden />
          <span className="absolute top-32 -right-[3px] h-16 w-[3px] rounded-r bg-[#0b0d12]" aria-hidden />

          {/* Screen */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2.25rem] [container-type:size] bg-gradient-to-b from-[#1e1b4b] via-[#15172b] to-[#0b0d12] text-white">
            <span
              className="absolute top-2 left-1/2 h-[1.15rem] w-20 -translate-x-1/2 rounded-full bg-black"
              aria-hidden
            />

            <div className="flex shrink-0 flex-col items-center px-5 pt-9 pb-2 text-center short:flex-row short:justify-center short:gap-2.5 short:pt-8 short:text-left">
              <div className="relative shrink-0">
                {status === 'ringing' && (
                  <span className="absolute inset-0 animate-ring rounded-full bg-indigo-400/50" />
                )}
                {live && call.agentSpeaking && (
                  <span className="absolute inset-0 animate-ring rounded-full bg-indigo-300/40" />
                )}
                <Logo className="relative h-12 w-12 rounded-full ring-2 ring-white/15 short:h-8 short:w-8" />
              </div>
              <div className="min-w-0">
                <h3 className="mt-2 text-[0.95rem] font-semibold short:mt-0">FlowQ Store</h3>
                <p className="text-xs text-indigo-200/80">
                  {status === 'idle' ? 'AI sales agent · answers instantly' : statusText}
                  {(live || status === 'ended') && (
                    <span className="ml-1.5 font-mono tabular-nums">{mmss(call.seconds)}</span>
                  )}
                </p>
              </div>
            </div>

            <div className="scroll-thin mx-3 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl bg-black/20 p-3">
              {call.error && (
                <div
                  className="sticky top-0 z-10 rounded-xl border border-red-400/40 bg-[#3b1219] p-3 text-xs text-red-100"
                  role="alert"
                >
                  <p className="font-semibold">
                    {call.error.kind === 'mic' ? 'Microphone unavailable' : 'Voice call unavailable'}
                  </p>
                  <p className="mt-1 text-red-200/90">{call.error.message}</p>
                  <p className="mt-1.5 text-white/70">
                    You can keep going in the WhatsApp panel — it works without voice.
                  </p>
                  <button onClick={call.dismissError} className="mt-1.5 cursor-pointer text-red-200 underline">
                    Dismiss
                  </button>
                </div>
              )}
              {lines.length === 0 && !call.error && (
                <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center text-xs text-white/50">
                  {status === 'idle' ? (
                    <>
                      <p className="text-sm text-white/85">Call as {customer.name}</p>
                      <p>Just talk. The live transcript appears here.</p>
                      {IS_MOCK && (
                        <p className="mt-2 text-amber-300/90">Mock mode: the call is a scripted simulation.</p>
                      )}
                    </>
                  ) : (
                    <p>{status === 'ringing' ? 'Connecting to the agent…' : 'Say something — FlowQ is listening.'}</p>
                  )}
                </div>
              )}
              {lines.map((l) =>
                l.role === 'tool' ? (
                  <div key={l.id} className="flex animate-rise justify-center">
                    <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 font-mono text-[0.6875rem] text-indigo-100">
                      <WrenchIcon className={`h-3 w-3 ${l.pending ? 'animate-spin' : ''}`} />
                      {l.text}
                    </span>
                  </div>
                ) : (
                  <div
                    key={l.id}
                    className={`flex animate-rise ${l.role === 'customer' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[86%] rounded-2xl px-3 py-1.5 text-[0.8125rem] leading-snug ${
                        l.role === 'customer'
                          ? 'rounded-br-md bg-indigo-500 text-white'
                          : 'rounded-bl-md bg-white/12 text-white'
                      }`}
                    >
                      {l.text || <span className="opacity-60">…</span>}
                      {l.interrupted && <span className="ml-1 text-[0.6875rem] text-amber-300">— interrupted</span>}
                    </div>
                  </div>
                ),
              )}
              <div ref={bottom} />
            </div>

            <div className="shrink-0 space-y-3 px-5 pt-3 pb-5 short:space-y-2 short:pb-3">
              <Waveform level={call.micLevel} agentSpeaking={call.agentSpeaking} live={live} />

              {active ? (
                <button onClick={call.end} className="group mx-auto flex cursor-pointer flex-col items-center gap-1.5">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-900/40 transition group-hover:bg-red-400 short:h-12 short:w-12">
                    <HangupIcon className="h-7 w-7 short:h-5 short:w-5" />
                  </span>
                  <span className="text-xs font-medium text-white/80">End call</span>
                </button>
              ) : (
                <button
                  onClick={call.start}
                  className="group mx-auto flex cursor-pointer flex-col items-center gap-1.5"
                >
                  <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 transition group-hover:bg-emerald-400 short:h-12 short:w-12">
                    <PhoneIcon className="h-7 w-7 short:h-5 short:w-5" />
                  </span>
                  <span className="text-xs font-medium text-white/80">
                    {status === 'ended' ? 'Call again' : 'Call FlowQ'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
