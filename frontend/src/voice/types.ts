export type CallStatus = 'idle' | 'ringing' | 'connected' | 'ended'
export type EndReason = 'user' | 'callback' | 'error' | 'remote'

export interface Line {
  id: string
  role: 'customer' | 'agent' | 'tool'
  text: string
  /** Still being spoken / transcribed. */
  pending?: boolean
  /** Agent line the customer talked over. */
  interrupted?: boolean
}

export interface CallError {
  kind: 'mic' | 'session' | 'realtime'
  message: string
}

/** What a call driver (real WebRTC or the mock script) may do to the UI state. */
export interface CallSink {
  upsertLine(line: Line): void
  patchLine(id: string, patch: Partial<Line> | ((l: Line) => Partial<Line>)): void
  removeLine(id: string): void
  setAgentSpeaking(v: boolean): void
  setUserSpeaking(v: boolean): void
  setMicLevel(v: number): void
  addLatency(ms: number): void
  connected(): void
  /** Driver asks for the call to be torn down. */
  hangup(reason: EndReason, error?: CallError): void
}

export interface CallDriver {
  stop(): void
  /** Tell the agent, mid-call, about something that happened outside the audio (e.g. photos uploaded). */
  notify?(text: string): void
}
