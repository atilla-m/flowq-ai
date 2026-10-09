// OpenAI Realtime over WebRTC, straight from the browser with an ephemeral key minted by our backend.
// Flow per the current OpenAI docs: SDP offer -> POST /v1/realtime/calls (Bearer <client_secret>),
// events over the "oai-events" data channel. Tool calls are forwarded to POST /api/tools/{name}.

import { api } from '../api/client'
import { asObj, pickArr, pickNum, pickStr } from '../lib/pick'
import type { RealtimeSession } from '../api/types'
import type { CallDriver, CallError, CallSink } from './types'

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

class StartError extends Error {
  kind: CallError['kind']
  constructor(kind: CallError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone access was denied. Allow the microphone for this site in the browser address bar, then call again.'
  if (name === 'NotFoundError') return 'No microphone was found on this device.'
  return `Could not open the microphone${e instanceof Error ? `: ${e.message}` : '.'}`
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {}
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

export function startRealtimeCall(phone: string, sink: CallSink): CallDriver {
  let stopped = false
  let pc: RTCPeerConnection | undefined
  let dc: RTCDataChannel | undefined
  let mic: MediaStream | undefined
  let audioCtx: AudioContext | undefined
  let raf = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const audioEl = document.createElement('audio')
  audioEl.autoplay = true

  // Call state driven by server events.
  let greeted = false
  let vadSilenceMs = 0 // learned from the server's session config
  let speechStoppedAt: number | undefined
  let agentAudioPlaying = false
  let currentAgentItem: string | undefined
  const handledCalls = new Set<string>()
  // schedule_callback was called: hang up once the agent has finished saying goodbye.
  let hangup: 'no' | 'after-next-response' | 'after-audio' = 'no'

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t)
      if (!stopped) fn()
    }, ms)
    timers.add(t)
  }

  const send = (event: unknown) => {
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event))
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf)
    timers.forEach(clearTimeout)
    try {
      dc?.close()
    } catch {
      // already closed
    }
    pc?.close()
    mic?.getTracks().forEach((t) => t.stop())
    audioCtx?.close().catch(() => {})
    audioEl.srcObject = null
  }

  const fail = (kind: CallError['kind'], message: string) => {
    if (stopped) return
    sink.hangup('error', { kind, message })
  }

  const greet = () => {
    if (greeted) return
    greeted = true
    // The agent picks up the phone and speaks first.
    send({ type: 'response.create' })
  }

  const meterMic = (stream: MediaStream) => {
    audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    audioCtx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Uint8Array(analyser.fftSize)
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 70) return
      last = now
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += ((v - 128) / 128) ** 2
      sink.setMicLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4))
    }
    raf = requestAnimationFrame(loop)
  }

  const runTools = async (calls: unknown[]) => {
    let callbackScheduled = false
    for (const call of calls) {
      const callId = pickStr(call, 'call_id')
      const name = pickStr(call, 'name')
      if (!callId || !name || handledCalls.has(callId)) continue
      handledCalls.add(callId)
      const lineId = `tool-${callId}`
      sink.upsertLine({ id: lineId, role: 'tool', text: name, pending: true })
      let result: unknown
      try {
        result = await api.callTool(name, phone, 'voice', parseArgs(asObj(call).arguments))
        if (name === 'schedule_callback') callbackScheduled = true
      } catch (e) {
        // Tell the model the truth so it clarifies or hands off instead of guessing.
        result = { error: 'tool_failed', message: e instanceof Error ? e.message : String(e) }
      }
      if (stopped) return
      sink.patchLine(lineId, { pending: false })
      send({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result ?? null) },
      })
    }
    send({ type: 'response.create' })
    if (callbackScheduled) {
      hangup = 'after-next-response'
      later(() => sink.hangup('callback'), 25_000) // safety net if the goodbye never completes
    }
  }

  const onEvent = (ev: Record<string, unknown>) => {
    const itemId = pickStr(ev, 'item_id')
    switch (ev.type) {
      case 'session.created':
      case 'session.updated': {
        const td = asObj(asObj(asObj(asObj(ev.session).audio).input).turn_detection)
        vadSilenceMs = pickNum(td, 'silence_duration_ms') ?? 0
        if (ev.type === 'session.updated') greet()
        break
      }

      case 'input_audio_buffer.speech_started':
        sink.setUserSpeaking(true)
        speechStoppedAt = undefined
        // Barge-in: the server cancels the response and truncates unplayed audio for WebRTC clients.
        if (agentAudioPlaying && currentAgentItem) sink.patchLine(currentAgentItem, { interrupted: true, pending: false })
        break

      case 'input_audio_buffer.speech_stopped':
        sink.setUserSpeaking(false)
        speechStoppedAt = performance.now()
        break

      case 'input_audio_buffer.committed':
        // Reserve the customer's bubble now so it sits above the agent's reply.
        if (itemId) sink.upsertLine({ id: itemId, role: 'customer', text: '', pending: true })
        break

      case 'conversation.item.input_audio_transcription.delta':
        if (itemId) sink.patchLine(itemId, (l) => ({ text: l.text + (pickStr(ev, 'delta') ?? '') }))
        break

      case 'conversation.item.input_audio_transcription.completed': {
        const text = (pickStr(ev, 'transcript') ?? '').trim()
        if (!itemId) break
        if (text) sink.upsertLine({ id: itemId, role: 'customer', text })
        else sink.removeLine(itemId)
        break
      }

      case 'conversation.item.input_audio_transcription.failed':
        if (itemId) sink.upsertLine({ id: itemId, role: 'customer', text: '(inaudible)' })
        break

      case 'response.output_audio_transcript.delta':
        if (!itemId) break
        if (currentAgentItem !== itemId) {
          currentAgentItem = itemId
          sink.upsertLine({ id: itemId, role: 'agent', text: '', pending: true })
        }
        sink.patchLine(itemId, (l) => ({ text: l.text + (pickStr(ev, 'delta') ?? '') }))
        break

      case 'response.output_audio_transcript.done':
        if (itemId) sink.patchLine(itemId, { pending: false })
        break

      case 'output_audio_buffer.started':
        agentAudioPlaying = true
        sink.setAgentSpeaking(true)
        if (speechStoppedAt !== undefined) {
          // speech_stopped only fires after the VAD silence window, so add it back to measure
          // from the moment the customer actually stopped talking.
          sink.addLatency(Math.round(performance.now() - speechStoppedAt + vadSilenceMs))
          speechStoppedAt = undefined
        }
        break

      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        agentAudioPlaying = false
        sink.setAgentSpeaking(false)
        if (hangup === 'after-audio') later(() => sink.hangup('callback'), 300)
        break

      case 'response.done': {
        const response = asObj(ev.response)
        const calls = pickArr(response, 'output').filter((o) => asObj(o).type === 'function_call')
        if (calls.length) {
          void runTools(calls)
        } else if (hangup === 'after-next-response' && response.status !== 'cancelled') {
          hangup = 'after-audio'
          if (!agentAudioPlaying) later(() => sink.hangup('callback'), 1200)
        }
        if (response.status === 'failed') {
          const detail = pickStr(asObj(asObj(response.status_details).error), 'message')
          fail('realtime', `The voice model failed to respond${detail ? `: ${detail}` : '.'}`)
        }
        break
      }

      case 'error': {
        const err = asObj(ev.error)
        console.warn('[realtime] error event', err)
        // A rejected session.update still leaves a usable session (backend-baked config applies).
        greet()
        break
      }
    }
  }

  const start = async () => {
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (e) {
      throw new StartError('mic', micErrorMessage(e))
    }
    if (stopped) return stop0()
    meterMic(mic)

    let session: RealtimeSession
    try {
      session = await api.realtimeSession(phone)
    } catch (e) {
      throw new StartError(
        'session',
        `The FlowQ backend could not start a voice session: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    if (stopped) return stop0()
    const key = typeof session.client_secret === 'string' ? session.client_secret : session.client_secret?.value
    if (!key) throw new StartError('session', 'The backend did not return a Realtime client secret.')

    pc = new RTCPeerConnection()
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0]
      audioEl.play().catch(() => {})
    }
    pc.addTrack(mic.getAudioTracks()[0], mic)
    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'failed') fail('realtime', 'The voice connection dropped.')
    }

    dc = pc.createDataChannel('oai-events')
    dc.onopen = () => {
      sink.connected()
      // The backend already bakes voice, server VAD and input transcription into the client
      // secret's session. Re-assert only the per-customer parts (prompt with memory, tools) so
      // they are guaranteed to be live before the agent's first word.
      send({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: session.instructions,
          tools: session.tools ?? [],
          tool_choice: 'auto',
        },
      })
      later(greet, 1500) // in case session.updated never arrives
    }
    dc.onmessage = (e) => {
      if (stopped) return
      try {
        onEvent(JSON.parse(e.data))
      } catch (err) {
        console.warn('[realtime] bad event', err)
      }
    }
    dc.onclose = () => {
      if (!stopped) sink.hangup('remote')
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    let res: Response
    try {
      res = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/sdp' },
      })
    } catch {
      throw new StartError('realtime', 'Could not reach OpenAI Realtime. Check your internet connection.')
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new StartError('realtime', `OpenAI Realtime rejected the call (${res.status}). ${body.slice(0, 200)}`)
    }
    const sdp = await res.text()
    if (stopped) return stop0()
    await pc.setRemoteDescription({ type: 'answer', sdp })
  }

  // stop() was called while we were awaiting: make sure late-acquired resources are released.
  const stop0 = () => {
    stopped = false
    stop()
  }

  start().catch((e) => {
    if (stopped) return
    if (e instanceof StartError) fail(e.kind, e.message)
    else fail('realtime', `Voice call failed: ${e instanceof Error ? e.message : String(e)}`)
  })

  const notify = (text: string) => {
    send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    })
    send({ type: 'response.create' })
  }

  return { stop, notify }
}
