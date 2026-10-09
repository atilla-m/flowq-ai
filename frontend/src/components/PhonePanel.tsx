import { useEffect, useRef } from 'react'
import { IS_MOCK } from '../api/client'
import type { Customer } from '../api/types'
import { mmss } from '../lib/pick'
import type { CallState } from '../voice/useCall'
import { toolLabel } from '../lib/toolLabels'
import { PhoneFrame } from './PhoneFrame'
import { BoltIcon, HangupIcon, Logo, MicIcon, PhoneIcon, SpeakerIcon, WrenchIcon } from './icons'

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

const ms = (n: number | undefined) => (n === undefined ? '—' : `${n} ms`)

function LatencyChip({ samples }: { samples: number[] }) {
  const last = samples.at(-1)
  return (
    <div className="call-latency" title={`Response time: ${ms(last)}. Median ${ms(median(samples))} over ${samples.length} turns. Includes silence detection and any tool round-trip.`}>
      <BoltIcon className="h-3.5 w-3.5" />
      <span>Response</span><strong>{ms(last)}</strong>
      <span className="latency-secondary">Median {ms(median(samples))}</span>
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
      <MicIcon className="h-4 w-4 shrink-0 text-ink-2" />
      <div className="flex h-8 flex-1 items-center justify-between">
        {Array.from({ length: bars }, (_, i) => {
          // A soft bell curve so the wave is tallest in the middle.
          const shape = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / bars)
          if (agentSpeaking)
            return (
              <span
                key={i}
                className="w-[3px] origin-center animate-wave rounded-full bg-ink-2"
                style={{ height: `${shape * 100}%`, animationDelay: `${(i % 7) * -0.13}s` }}
              />
            )
          const h = live ? Math.max(0.12, Math.min(1, level * 1.6) * shape) : 0.12
          return (
            <span
              key={i}
              className={`h-full w-[3px] origin-center rounded-full transition-transform duration-100 ${live && level > 0.06 ? 'bg-ink-2' : 'bg-ink-2/30'}`}
              style={{ transform: `scaleY(${h})` }}
            />
          )
        })}
      </div>
    </div>
  )
}

const END_TEXT: Record<string, string> = {
  callback: 'Callback scheduled',
  error: 'Call ended unexpectedly',
  remote: 'Call ended by agent',
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
          ? 'Agent speaking'
          : call.userSpeaking
            ? 'Listening…'
            : 'Connected'
        : status === 'ended'
          ? END_TEXT[call.endReason ?? 'user']
          : 'Ready'

  return (
    <PhoneFrame label="Voice call" className={`call-phone ${active ? 'is-active' : ''}`}>
      <header className="call-header">
        <span className={`call-avatar ${status === 'ringing' ? 'is-ringing' : ''}`} aria-hidden><Logo /></span>
        <h3 translate="no">FlowQ Store</h3>
        <p className="call-number">AI assistant</p>
        <div className="call-status-time">
          <span className={`call-status ${live ? 'is-live' : ''}`} role="status">{statusText}</span>
          {(live || status === 'ended') && <span className="call-clock" aria-label={`Call duration ${mmss(call.seconds)}`}>{mmss(call.seconds)}</span>}
        </div>
        {IS_MOCK && <span className="call-mode">Mock call</span>}
      </header>

      <div className="call-transcript scroll-thin" role="log" aria-label="Call transcript" aria-live="polite" aria-relevant="additions">
        {call.error && (
          <div className="call-error" role="alert">
            <p className="font-semibold">{call.error.kind === 'mic' ? 'Microphone unavailable' : 'Voice call unavailable'}</p>
            <p>{call.error.message}</p>
            <p>Continue in WhatsApp or retry the call.</p>
            <button onClick={call.dismissError}>Dismiss</button>
          </div>
        )}
        {lines.map((l) => l.role === 'tool' ? (
          <div key={l.id} className="transcript-tool">
            <WrenchIcon className={`h-3 w-3 ${l.pending ? 'animate-spin' : ''}`} />
            <span>{toolLabel(l.text, l.pending)}</span>
          </div>
        ) : (
          <div key={l.id} className={`transcript-turn ${l.role === 'customer' ? 'transcript-customer' : 'transcript-agent'}`}>
            <span className="transcript-speaker">{l.role === 'customer' ? customer.name.split(' ')[0] : 'Agent'}</span>
            <p>{l.text || <span className="opacity-60">…</span>}
              {l.interrupted && <span className="interrupted"> — interrupted</span>}
            </p>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="call-controls">
        <div className="call-waveform-slot">
          {live && (call.agentSpeaking || call.userSpeaking) && <Waveform level={call.micLevel} agentSpeaking={call.agentSpeaking} live={live} />}
        </div>
        {active ? (
          <div className="ios-button-row">
            <div className="ios-control">
              <button disabled className="ios-secondary" aria-label="Mute unavailable" title="Mute control unavailable"><MicIcon /></button>
              <span>Mute</span>
            </div>
            <div className="ios-control">
              <button disabled className="ios-secondary" aria-label="Speaker control unavailable" title="Speaker routing is managed by your device"><SpeakerIcon /></button>
              <span>Speaker</span>
            </div>
            <div className="ios-control">
              <button onClick={call.end} className="call-button call-button-end" aria-label="End call" title="End call">
                <HangupIcon />
              </button>
              <span>End</span>
            </div>
          </div>
        ) : (
          <button onClick={call.start} className="call-button" aria-label={status === 'ended' ? 'Call again' : 'Call FlowQ'} title={status === 'ended' ? 'Call again' : 'Start call'}>
            <PhoneIcon />
          </button>
        )}
        {!active && <span className="call-button-label">{status === 'ended' ? 'Call again' : 'Call'}</span>}
        {(live || status === 'ended') && <LatencyChip samples={call.latencies} />}
      </div>
    </PhoneFrame>
  )
}
