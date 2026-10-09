// Scripted stand-in for the Realtime call, used only when VITE_MOCK=1. It drives the same UI sink
// and the same tool endpoint as the real call, so transcript, trace, WhatsApp pushes and the
// callback flow can all be built and rehearsed without a microphone or an OpenAI key.

import { api } from '../api/client'
import type { CallDriver, CallSink } from './types'

type Step =
  | { agent: string }
  | { customer: string }
  | { tool: string; args?: Record<string, unknown> }
  | { hangup: 'callback' }

const FIRST_CALL: Step[] = [
  { tool: 'get_customer_history' },
  { agent: 'Hi Aysel, this is FlowQ. Last time you were looking at upgrading to an iPhone 15. Shall we continue?' },
  { customer: 'Yes. Do you have the iPhone 15 in black, 128 gigabytes? I also want to trade in my iPhone 12.' },
  { agent: 'One second, let me check.' },
  { tool: 'search_inventory', args: { query: 'iPhone 15 128 Black' } },
  { tool: 'request_media_whatsapp', args: { what: 'iPhone 12 trade-in' } },
  { agent: 'Yes, it is in stock for 1399 AZN. I just sent photo instructions to your WhatsApp for the trade-in.' },
  { customer: 'OK, but I have no balance right now. Please call me back.' },
  { tool: 'schedule_callback', args: { delay_seconds: 8 } },
  { agent: 'Of course, I will call you back in a few seconds. Goodbye!' },
  { hangup: 'callback' },
]

const CALLBACK_CALL: Step[] = [
  { tool: 'get_customer_history' },
  { agent: 'Hi again, this is FlowQ calling you back. We were talking about the iPhone 15 and your trade-in. Were you able to send the photos?' },
  { customer: 'Yes, I am uploading them to WhatsApp now.' },
  { agent: 'Great. As soon as they arrive I will give you the price.' },
]

let callCount = 0

export function startMockCall(phone: string, sink: CallSink): CallDriver {
  let stopped = false
  let level: ReturnType<typeof setInterval> | undefined
  const script = callCount++ % 2 === 0 ? FIRST_CALL : CALLBACK_CALL
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const speak = async (id: string, role: 'agent' | 'customer', text: string) => {
    sink.upsertLine({ id, role, text: '', pending: true })
    const words = text.split(' ')
    for (let i = 0; i < words.length && !stopped; i++) {
      sink.patchLine(id, { text: words.slice(0, i + 1).join(' ') })
      await sleep(role === 'agent' ? 110 : 140)
    }
    if (!stopped) sink.patchLine(id, { pending: false })
  }

  const run = async () => {
    await sleep(1400) // ringing
    if (stopped) return
    sink.connected()
    level = setInterval(() => sink.setMicLevel(0), 500)
    let n = 0
    let customerJustSpoke = false
    for (const step of script) {
      if (stopped) return
      const id = `mock-${Date.now()}-${n++}`
      if ('agent' in step) {
        if (customerJustSpoke) {
          const latency = 520 + Math.round(Math.random() * 380)
          await sleep(latency)
          sink.addLatency(latency)
          customerJustSpoke = false
        }
        sink.setAgentSpeaking(true)
        await speak(id, 'agent', step.agent)
        sink.setAgentSpeaking(false)
        await sleep(500)
      } else if ('customer' in step) {
        sink.setUserSpeaking(true)
        const wobble = setInterval(() => sink.setMicLevel(0.25 + Math.random() * 0.6), 90)
        await speak(id, 'customer', step.customer)
        clearInterval(wobble)
        sink.setMicLevel(0)
        sink.setUserSpeaking(false)
        customerJustSpoke = true
      } else if ('tool' in step) {
        sink.upsertLine({ id, role: 'tool', text: step.tool, pending: true })
        await api.callTool(step.tool, phone, 'voice', step.args ?? {}).catch(() => null)
        if (stopped) return
        sink.patchLine(id, { pending: false })
      } else {
        await sleep(400)
        if (!stopped) sink.hangup(step.hangup)
      }
    }
  }
  void run()

  return {
    stop() {
      stopped = true
      clearInterval(level)
    },
  }
}
