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
    <div className="call-latency" title="Time from the customer finishing speaking to the first agent audio. Includes silence detection and any tool round-trip.">
      <BoltIcon className="h-4 w-4" />
      <span>Response time</span>
      <strong className={tone}>{ms(last)}</strong>
      <span className="latency-secondary">Median {ms(median(samples))} over {samples.length} turns</span>
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
    <div className="call-waveform" role="img" aria-label="Microphone level">
      <MicIcon className={`h-4 w-4 shrink-0 ${live ? 'text-white' : 'text-white/70'}`} />
      <div className="flex h-8 flex-1 items-center justify-between">
        {Array.from({ length: bars }, (_, i) => {
          // A soft bell curve so the wave is tallest in the middle.
          const shape = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / bars)
          if (agentSpeaking)
            return (
              <span
                key={i}
                className="w-[3px] origin-center animate-wave rounded-full bg-white"
                style={{ height: `${shape * 100}%`, animationDelay: `${(i % 7) * -0.13}s` }}
              />
            )
          const h = live ? Math.max(0.12, Math.min(1, level * 1.6) * shape) : 0.12
          return (
            <span
              key={i}
              className={`w-[3px] rounded-full transition-[height] duration-100 ${live && level > 0.06 ? 'bg-white' : 'bg-white/40'}`}
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
    bottom.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'end',
    })
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

  const dot = live ? 'bg-emerald-300' : status === 'ringing' ? 'animate-pulse bg-amber-200' : 'bg-white/60'

  return (
    <section className="call-panel" aria-label="Voice call">
      <header className="call-header">
        <div className="call-channel"><PhoneIcon className="h-4 w-4" /><h2>Voice call</h2></div>
        <p className="call-status" role="status"><span className={`status-dot ${dot}`} />{statusText}</p>
      </header>

      <div className="call-stage">
        <div className="call-identity">
          <div className="store-identity">
            <Logo className="store-mark" />
            <h3>FlowQ<br />Store</h3>
            <p className="store-promise">Your AI shop assistant.<br />Answers instantly.</p>
          </div>
          <div className="caller-identity">
            <span>{active ? 'On the line with' : 'Call as'}</span>
            <strong title={customer.name}>{customer.name}</strong>
            <span className="caller-number">{customer.phone}</span>
          </div>
          <div className="call-clock" aria-label={`Call duration ${mmss(call.seconds)}`}>{mmss(call.seconds)}</div>
          <div className="call-controls">
            <Waveform level={call.micLevel} agentSpeaking={call.agentSpeaking} live={live} />
            {active ? (
              <button onClick={call.end} className="call-button call-button-end">
                <HangupIcon className="h-5 w-5" /><span>End call</span>
              </button>
            ) : (
              <button onClick={call.start} className="call-button">
                <PhoneIcon className="h-5 w-5" /><span>{status === 'ended' ? 'Call again' : 'Call FlowQ'}</span>
              </button>
            )}
            <p className="call-control-hint">{IS_MOCK ? 'Mock call · scripted simulation' : 'Speak naturally. FlowQ is listening.'}</p>
          </div>
        </div>

        <div className="call-conversation">
          <div className="transcript-heading"><h3>Live transcript</h3><span>Voice &amp; WhatsApp, together</span></div>
          <div className="call-transcript scroll-thin" role="log" aria-label="Call transcript" aria-live="polite" aria-relevant="additions">
            {call.error && (
              <div className="call-error" role="alert">
                <p className="font-semibold">{call.error.kind === 'mic' ? 'Microphone unavailable' : 'Voice call unavailable'}</p>
                <p>{call.error.message}</p>
                <p>You can keep going in the WhatsApp panel — it works without voice.</p>
                <button onClick={call.dismissError} className="cursor-pointer underline">Dismiss</button>
              </div>
            )}
            {lines.length === 0 && !call.error && (
              <div className="transcript-empty">
                <span className="empty-call-symbol" aria-hidden><PhoneIcon /></span>
                <p>{status === 'idle' ? 'Good conversations start here.' : status === 'ringing' ? 'Connecting to the agent…' : 'FlowQ is listening.'}</p>
                <span>{status === 'idle' ? 'Ask about stock, trade-ins or delivery. Your conversation appears here as you talk.' : 'Your words and the agent’s answers appear here live.'}</span>
              </div>
            )}
            {lines.map((l) => l.role === 'tool' ? (
              <div key={l.id} className="transcript-tool">
                <WrenchIcon className={`h-3.5 w-3.5 ${l.pending ? 'animate-spin' : ''}`} /><span>{l.text.replace(/_/g, ' ')}</span>
              </div>
            ) : (
              <div key={l.id} className={`transcript-turn ${l.role === 'customer' ? 'transcript-customer' : 'transcript-agent'}`}>
                <span className="transcript-speaker">{l.role === 'customer' ? customer.name.split(' ')[0] : 'FlowQ'}</span>
                <p>{l.text || <span className="opacity-60">…</span>}
                  {l.interrupted && <span className="interrupted"> — interrupted</span>}
                </p>
              </div>
            ))}
            <div ref={bottom} />
          </div>
          <LatencyChip samples={call.latencies} />
        </div>
      </div>
    </section>
  )
}
