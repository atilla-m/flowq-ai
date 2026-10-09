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
  { agent: 'Salam, Aysel xanım! FlowQ-dur. Keçən dəfə iPhone 15-ə keçmək istəyirdiniz — davam edək?' },
  { customer: 'Bəli. iPhone 15, 128 giqabayt, qara rəng var? Köhnə iPhone 13-ü də vermək istəyirəm.' },
  { agent: 'Bir saniyə, yoxlayıram.' },
  { tool: 'search_inventory', args: { query: 'iPhone 15 128 Black' } },
  { tool: 'request_media_whatsapp', args: { device: 'iPhone 13' } },
  { agent: 'Bəli, stokda var — 1399 manat. Trade-in üçün WhatsApp-a təlimat göndərdim, şəkilləri ora yükləyin.' },
  { customer: 'Yaxşı, amma indi vaxtım yoxdur. Mənə geri zəng edin.' },
  { tool: 'schedule_callback', args: { delay_seconds: 8 } },
  { agent: 'Əlbəttə, bir neçə saniyəyə zəng edirəm. Sağ olun!' },
  { hangup: 'callback' },
]

const CALLBACK_CALL: Step[] = [
  { tool: 'get_customer_history' },
  { agent: 'Salam, yenə FlowQ-dur. iPhone 15 və trade-in haqqında danışırdıq — şəkilləri göndərə bildiniz?' },
  { customer: 'Hə, indi WhatsApp-a yükləyirəm.' },
  { agent: 'Əla, şəkillər gələn kimi qiyməti deyəcəm.' },
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
