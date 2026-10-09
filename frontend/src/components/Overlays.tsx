import { useEffect } from 'react'
import { CloseIcon, HangupIcon, Logo, PhoneIcon, UserIcon } from './icons'

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
      className="fixed inset-0 z-50 flex animate-rise flex-col items-center justify-between bg-gradient-to-b from-[#1e1b4b] via-[#11132a] to-[#07080d] px-6 py-16 text-center text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Incoming call from FlowQ"
    >
      <div>
        <p className="text-sm font-medium tracking-[0.2em] text-indigo-200 uppercase">Incoming call</p>
        <h2 className="mt-3 text-4xl font-semibold tracking-tight">FlowQ is calling you back</h2>
        <p className="mt-2 text-indigo-200/70">FlowQ Store · AI sales agent</p>
      </div>

      <div className="relative">
        <span className="absolute inset-0 animate-ring rounded-full bg-indigo-400/40" />
        <span className="absolute inset-0 animate-ring rounded-full bg-indigo-400/30 [animation-delay:0.6s]" />
        <Logo className="relative h-32 w-32 rounded-full ring-4 ring-white/15" />
      </div>

      <div className="flex gap-20">
        <button onClick={onDecline} className="group flex cursor-pointer flex-col items-center gap-2 text-sm text-white/80">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-900/40 transition group-hover:bg-red-400">
            <HangupIcon className="h-7 w-7" />
          </span>
          Decline
        </button>
        <button onClick={onAccept} autoFocus className="group flex cursor-pointer flex-col items-center gap-2 text-sm text-white/80">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 transition group-hover:bg-emerald-400">
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
    <div className="mx-4 mt-3 flex animate-rise items-start gap-3 rounded-2xl border border-accent/25 bg-accent-soft px-4 py-3" role="status">
      <span className="mt-0.5 rounded-full bg-accent p-1.5 text-on-accent">
        <UserIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-accent-ink">Transferred to a human agent with summary</p>
        <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink-2">{summary}</p>
      </div>
      <button onClick={onClose} className="cursor-pointer rounded-lg p-1 text-ink-3 hover:text-ink" aria-label="Dismiss">
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  )
}
