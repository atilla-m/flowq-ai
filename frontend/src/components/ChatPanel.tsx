import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Customer, Message } from '../api/types'
import { ChevronIcon, ClipIcon, CloseIcon, Logo, MoreIcon, SendIcon, VerifiedIcon } from './icons'
import { MessageBubble } from './MessageBubble'
import { PhoneFrame } from './PhoneFrame'

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

// Backend limits (see backend/main.py): at most 8 media_ids per chat turn; JPEG, PNG or WebP only.
const MAX_PHOTOS = 8
const ACCEPT = 'image/jpeg,image/png,image/webp'

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
    bottom.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'end',
    })
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
      setError(`Couldn’t send: ${e instanceof Error ? e.message : 'message failed'}`)
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
    const picked = [...(list ?? [])]
    const files = picked.filter((f) => ACCEPT.split(',').includes(f.type))
    if (fileInput.current) fileInput.current.value = ''
    if (files.length < picked.length) setError('Only JPEG, PNG or WebP photos can be sent.')
    const room = MAX_PHOTOS - drafts.length
    if (files.length > room) setError(`You can send up to ${MAX_PHOTOS} photos in one message.`)
    setDrafts((prev) => [
      ...prev,
      ...files.slice(0, Math.max(0, room)).map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ])
  }

  return (
    <PhoneFrame label="WhatsApp chat" className="whatsapp-phone">
      <header className="chat-header">
        <ChevronIcon className="h-5 w-5 rotate-90 shrink-0" />
        <span className="chat-avatar" aria-hidden><Logo className="h-8 w-8" /></span>
        <div className="min-w-0 flex-1">
          <h3><span translate="no">FlowQ Store</span><VerifiedIcon className="verified-badge" /></h3>
          <p>{!online ? 'reconnecting…' : callActive ? 'on a call' : 'online'}</p>
        </div>
        <MoreIcon className="chat-menu h-5 w-5" />
      </header>
      <div className="wa-wallpaper chat-messages scroll-thin min-h-0 flex-1 overflow-y-auto" role="log" aria-label="WhatsApp messages" aria-live="polite" aria-relevant="additions">
        {visible.length === 0 && (
          <div className="chat-empty">
            No messages
          </div>
        )}
        {visible.map((m) => (
          <MessageBubble key={m.id} message={m} onUploadPhotos={() => fileInput.current?.click()} />
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="chat-typing rounded-lg rounded-tl-none px-3 py-2.5">
              <span className="flex gap-1">
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-wa-meta"
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
        <div className="chat-error" role="alert">
          <span className="min-w-0 break-words">{error}</span>
          <button onClick={() => setError(null)} className="cursor-pointer" aria-label="Dismiss">
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {drafts.length > 0 && (
        <div className="chat-drafts flex gap-2 overflow-x-auto px-4 pt-2">
          {drafts.map((d, i) => (
            <div key={d.preview} className="relative shrink-0">
              <img src={d.preview} alt={`Photo ${i + 1} to send`} width={64} height={64} className="h-16 w-16 rounded-md object-cover" />
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
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          ref={fileInput}
          type="file"
          name="photos"
          aria-label="Choose photos to send"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="chat-attach cursor-pointer rounded-full p-2"
          aria-label="Attach photos"
          title="Attach photos"
        >
          <ClipIcon className="h-5 w-5" />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={drafts.length ? 'Message or photo caption' : 'Message FlowQ'}
          name="message"
          autoComplete="off"
          placeholder={drafts.length ? 'Add a caption…' : 'Message…'}
          className="min-w-0 flex-1 rounded-full px-4 py-2 text-sm text-wa-ink placeholder:text-wa-meta"
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
    </PhoneFrame>
  )
}
