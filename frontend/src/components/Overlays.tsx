import { useEffect } from 'react'
import { CloseIcon, HangupIcon, PhoneIcon, UserIcon } from './icons'

/** Soft two-tone ring while the incoming-call screen is up. Silently skipped if audio is blocked. */
function useRingtone() {
  useEffect(() => {
    let ctx: AudioContext | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    try {
      ctx = new AudioContext()
      const audio = ctx
      const ring = () => {
        if (audio.state !== 'running') return
        for (const [freq, at] of [
          [880, 0],
          [660, 0.22],
        ]) {
          const osc = audio.createOscillator()
          const gain = audio.createGain()
          osc.frequency.value = freq
          gain.gain.setValueAtTime(0.0001, audio.currentTime + at)
          gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + at + 0.03)
          gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.2)
          osc.connect(gain).connect(audio.destination)
          osc.start(audio.currentTime + at)
          osc.stop(audio.currentTime + at + 0.22)
        }
      }
      ring()
      timer = setInterval(ring, 1400)
    } catch {
      // no audio: the visual ring is enough
    }
    return () => {
      clearInterval(timer)
      ctx?.close().catch(() => {})
    }
  }, [])
}

export function IncomingCall({ onAccept, onDecline }: { onAccept(): void; onDecline(): void }) {
  useRingtone()
  return (
    <div
      className="incoming-call"
      role="dialog"
      aria-modal="true"
      aria-label="Incoming call from FlowQ"
    >
      <div><p>Incoming call</p><h2>Shop assistant</h2></div>
      <div className="incoming-avatar" aria-hidden><UserIcon className="h-8 w-8" /></div>

      <div className="incoming-actions">
        <button onClick={onDecline} className="incoming-action">
          <span className="call-button call-button-end">
            <HangupIcon className="h-7 w-7" />
          </span>
          Decline
        </button>
        <button onClick={onAccept} autoFocus className="incoming-action">
          <span className="call-button">
            <PhoneIcon className="h-7 w-7" />
          </span>
          Accept
        </button>
      </div>
    </div>
  )
}

export function HandoffBanner({ summary, onClose }: { summary: string; onClose(): void }) {
  return (
    <div className="handoff-banner" role="status">
      <span className="mt-0.5 text-ink-2">
        <UserIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">Transferred to a human agent with summary</p>
        <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink-2">{summary}</p>
      </div>
      <button onClick={onClose} className="cursor-pointer rounded-lg p-1 text-ink-3 hover:text-ink" aria-label="Dismiss">
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  )
}
