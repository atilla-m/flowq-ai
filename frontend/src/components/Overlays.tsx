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
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-gradient-to-b from-slate-900 via-slate-950 to-black px-6 py-16 text-center"
      role="dialog"
      aria-modal="true"
      aria-label="Incoming call from FlowQ"
    >
      <div>
        <p className="text-sm tracking-widest text-emerald-300 uppercase">Incoming call</p>
        <h2 className="mt-3 text-4xl font-semibold">FlowQ is calling you back</h2>
        <p className="mt-2 text-slate-400">FlowQ Store · AI sales agent</p>
      </div>

      <div className="relative">
        <span className="absolute inset-0 animate-ring rounded-full bg-emerald-400/40" />
        <span className="absolute inset-0 animate-ring rounded-full bg-emerald-400/30 [animation-delay:0.6s]" />
        <Logo className="relative h-32 w-32 rounded-full ring-4 ring-white/10" />
      </div>

      <div className="flex gap-16">
        <button onClick={onDecline} className="group flex cursor-pointer flex-col items-center gap-2 text-sm text-slate-300">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white transition group-hover:bg-red-500">
            <HangupIcon className="h-7 w-7" />
          </span>
          Decline
        </button>
        <button onClick={onAccept} autoFocus className="group flex cursor-pointer flex-col items-center gap-2 text-sm text-slate-300">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-slate-950 transition group-hover:bg-emerald-400">
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
    <div className="mx-4 mt-3 flex animate-rise items-start gap-3 rounded-xl border border-sky-400/40 bg-sky-500/10 px-4 py-3" role="status">
      <span className="mt-0.5 rounded-full bg-sky-400/20 p-1.5 text-sky-200">
        <UserIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-sky-100">Transferred to a human agent with summary</p>
        <p className="mt-0.5 text-sm whitespace-pre-wrap text-slate-200">{summary}</p>
      </div>
      <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-200" aria-label="Dismiss">
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  )
}
