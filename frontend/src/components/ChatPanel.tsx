import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Customer, Message } from '../api/types'
import { ClipIcon, CloseIcon, Logo, SendIcon } from './icons'
import { MessageBubble } from './MessageBubble'

interface Props {
  customer: Customer
  messages: Message[]
  online: boolean
  /** A voice call is live: photo uploads go to the voice agent instead of starting a chat turn. */
  callActive: boolean
  onUploadDuringCall(mediaIds: string[]): void
  addLocal(m: Omit<Message, 'id' | 'ts'>): void
  mergeServer(m: Message[]): void
}

interface Draft {
  file: File
  preview: string
}

export function ChatPanel({ customer, messages, online, callActive, onUploadDuringCall, addLocal, mergeServer }: Props) {
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const phone = customer.phone
  // The backend stores an empty text row for photo-only turns; don't render blank bubbles.
  const visible = messages.filter((m) => m.type !== 'text' || m.text?.trim())

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [visible.length, busy])

  const send = async (body: string, files: File[]) => {
    const trimmed = body.trim()
    if (!trimmed && !files.length) return
    setError(null)
    setBusy(true)
    try {
      const mediaIds: string[] = []
      for (const file of files) {
        const { media_id, url } = await api.uploadMedia(phone, file)
        mediaIds.push(media_id)
        addLocal({ from: 'customer', type: 'image', image_url: url, data: { media_id } })
      }
      if (trimmed) addLocal({ from: 'customer', type: 'text', text: trimmed })
      // During a call the voice agent picks the photos up via analyze_device_media; a parallel
      // WhatsApp turn would make two agents answer at once.
      if (callActive && !trimmed) {
        onUploadDuringCall(mediaIds)
        return
      }
      const res = await api.chat(phone, trimmed, mediaIds)
      mergeServer(res.messages ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Message failed to send')
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    const files = drafts.map((d) => d.file)
    drafts.forEach((d) => URL.revokeObjectURL(d.preview))
    setDrafts([])
    const body = text
    setText('')
    void send(body, files)
  }

  const onFiles = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith('image/'))
    if (fileInput.current) fileInput.current.value = ''
    if (!files.length) return
    setDrafts((prev) => [...prev, ...files.map((file) => ({ file, preview: URL.createObjectURL(file) }))])
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 shadow-xl">
      <header className="flex items-center gap-3 bg-wa-header px-4 py-2.5 text-white">
        <Logo className="h-9 w-9 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">FlowQ Store</div>
          <div className="truncate text-xs text-emerald-100">
            {!online ? 'reconnecting…' : callActive ? 'on a call with you · messages arrive live' : 'online'}
          </div>
        </div>
        <div className="text-right text-xs text-emerald-100">
          <div className="font-medium text-white">{customer.name}</div>
          <div>{customer.phone}</div>
        </div>
      </header>

      <div className="wa-wallpaper scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
        {visible.length === 0 && (
          <div className="mx-auto mt-6 max-w-xs rounded-lg bg-[#fff5c4] px-3 py-2 text-center text-xs text-wa-ink shadow-sm">
            Write to FlowQ in Azerbaijani or Russian — e.g. “iPhone 15 neçəyədir?”
          </div>
        )}
        {visible.map((m) => (
          <MessageBubble key={m.id} message={m} onUploadPhotos={() => fileInput.current?.click()} />
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-lg rounded-tl-none bg-white px-3 py-2.5 shadow-sm">
              <span className="flex gap-1">
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-wa-meta"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 bg-red-50 px-4 py-1.5 text-xs text-red-700">
          <span className="truncate">Couldn’t send: {error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer" aria-label="Dismiss">
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {drafts.length > 0 && (
        <div className="flex gap-2 overflow-x-auto bg-[#f0f2f5] px-4 pt-2">
          {drafts.map((d, i) => (
            <div key={d.preview} className="relative shrink-0">
              <img src={d.preview} alt="" className="h-16 w-16 rounded-md object-cover" />
              <button
                onClick={() => {
                  URL.revokeObjectURL(d.preview)
                  setDrafts((prev) => prev.filter((_, j) => j !== i))
                }}
                className="absolute -top-1.5 -right-1.5 cursor-pointer rounded-full bg-slate-700 p-0.5 text-white"
                aria-label="Remove photo"
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2 bg-[#f0f2f5] px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="cursor-pointer rounded-full p-2 text-slate-500 transition hover:bg-black/5 hover:text-slate-700"
          aria-label="Attach photos"
          title="Attach photos"
        >
          <ClipIcon className="h-5 w-5" />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={drafts.length ? 'Add a caption (optional)' : 'Mesaj yazın'}
          className="min-w-0 flex-1 rounded-full bg-white px-4 py-2 text-sm text-wa-ink outline-none placeholder:text-wa-meta"
        />
        <button
          type="submit"
          disabled={busy || (!text.trim() && !drafts.length)}
          className="cursor-pointer rounded-full bg-wa-header p-2.5 text-white transition hover:brightness-110 disabled:cursor-default disabled:opacity-40"
          aria-label="Send"
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </form>
    </section>
  )
}
