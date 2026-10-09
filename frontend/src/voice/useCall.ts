import { useCallback, useEffect, useRef, useState } from 'react'
import { api, IS_MOCK } from '../api/client'
import { startMockCall } from './mockCall'
import { startRealtimeCall } from './realtime'
import type { CallDriver, CallError, CallSink, CallStatus, EndReason, Line } from './types'

export interface CallState {
  status: CallStatus
  endReason: EndReason | null
  error: CallError | null
  lines: Line[]
  seconds: number
  micLevel: number
  agentSpeaking: boolean
  userSpeaking: boolean
  latencies: number[]
  start(): void
  end(): void
  dismissError(): void
}

export function useCall(phone: string): CallState {
  const [status, setStatus] = useState<CallStatus>('idle')
  const [endReason, setEndReason] = useState<EndReason | null>(null)
  const [error, setError] = useState<CallError | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [seconds, setSeconds] = useState(0)
  const [micLevel, setMicLevel] = useState(0)
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [userSpeaking, setUserSpeaking] = useState(false)
  const [latencies, setLatencies] = useState<number[]>([])

  const driver = useRef<CallDriver | null>(null)
  const linesRef = useRef<Line[]>([])
  const wasConnected = useRef(false)
  const ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const updateLines = useCallback((fn: (prev: Line[]) => Line[]) => {
    linesRef.current = fn(linesRef.current)
    setLines(linesRef.current)
  }, [])

  const finish = useCallback(
    (reason: EndReason, err?: CallError) => {
      if (!driver.current) return
      driver.current.stop()
      driver.current = null
      clearInterval(ticker.current)
      setAgentSpeaking(false)
      setUserSpeaking(false)
      setMicLevel(0)
      setEndReason(reason)
      if (err) setError(err)
      updateLines((prev) => prev.filter((l) => l.text || !l.pending).map((l) => ({ ...l, pending: false })))
      // A call that never connected goes back to the dial screen; the error explains why.
      setStatus(wasConnected.current ? 'ended' : 'idle')
      if (wasConnected.current) {
        const transcript = linesRef.current
          .filter((l) => l.role !== 'tool' && l.text.trim())
          .map((l) => `${l.role === 'agent' ? 'Agent' : 'Customer'}: ${l.text.trim()}`)
          .join('\n')
        api.endCall(phone, transcript).catch((e) => console.warn('call/end failed', e))
      }
    },
    [phone, updateLines],
  )

  const start = useCallback(() => {
    if (driver.current) return
    wasConnected.current = false
    setError(null)
    setEndReason(null)
    setSeconds(0)
    updateLines(() => [])
    setStatus('ringing')

    const sink: CallSink = {
      upsertLine: (line) =>
        updateLines((prev) => {
          const i = prev.findIndex((l) => l.id === line.id)
          if (i < 0) return [...prev, line]
          const next = [...prev]
          next[i] = line
          return next
        }),
      patchLine: (id, patch) =>
        updateLines((prev) =>
          prev.map((l) => (l.id === id ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l)),
        ),
      removeLine: (id) => updateLines((prev) => prev.filter((l) => l.id !== id)),
      setAgentSpeaking,
      setUserSpeaking,
      setMicLevel,
      addLatency: (ms) => setLatencies((prev) => [...prev, ms]),
      connected: () => {
        wasConnected.current = true
        setStatus('connected')
        const t0 = Date.now()
        clearInterval(ticker.current)
        ticker.current = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 500)
      },
      hangup: (reason, err) => finish(reason, err),
    }

    driver.current = IS_MOCK ? startMockCall(phone, sink) : startRealtimeCall(phone, sink)
  }, [phone, finish, updateLines])

  const end = useCallback(() => finish('user'), [finish])

  // Leaving the page or switching customer hangs up and still saves the call summary.
  useEffect(() => () => finish('user'), [finish])

  return {
    status,
    endReason,
    error,
    lines,
    seconds,
    micLevel,
    agentSpeaking,
    userSpeaking,
    latencies,
    start,
    end,
    dismissError: useCallback(() => setError(null), []),
  }
}
