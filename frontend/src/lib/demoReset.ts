// "Reset demo" is frontend-only: it remembers, per customer and in this browser, the timestamp of
// the newest message and trace entry at the moment of the reset, and the UI hides everything up to
// those points. Nothing is deleted on the backend, so the agent's memory and orders are untouched.

export interface DemoReset {
  /** Server timestamp of the newest inbox message that existed at reset time. */
  messagesUpTo?: string
  /** Server timestamp of the newest trace entry that existed at reset time. */
  traceUpTo?: string
  /** Browser time of the reset, for display only. */
  at: string
}

const key = (phone: string) => `flowq-demo-reset:${phone}`

export function loadReset(phone: string): DemoReset | null {
  try {
    const raw = localStorage.getItem(key(phone))
    return raw ? (JSON.parse(raw) as DemoReset) : null
  } catch {
    return null
  }
}

export function saveReset(phone: string, reset: DemoReset | null) {
  try {
    if (reset) localStorage.setItem(key(phone), JSON.stringify(reset))
    else localStorage.removeItem(key(phone))
  } catch {
    // storage unavailable: the reset still applies until the page reloads
  }
}

/** Backend timestamps carry microseconds; Date.parse only sees milliseconds, so break ties on the string. */
export function newer(a: string, b: string) {
  const d = Date.parse(a) - Date.parse(b)
  return d > 0 || (d === 0 && a > b)
}

export function latestTs(items: { ts: string }[]): string | undefined {
  let max: string | undefined
  for (const it of items) if (!max || newer(it.ts, max)) max = it.ts
  return max
}
