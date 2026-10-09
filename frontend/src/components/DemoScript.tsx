import { useState } from 'react'
import { CheckIcon, ChevronIcon } from './icons'

interface Step {
  title: string
  say?: string
  expect: string
}

const STEPS: Step[] = [
  {
    title: 'Pick Aysel and press “Call FlowQ”',
    expect: 'Agent answers instantly, greets her by name and recalls she wanted an iPhone 15.',
  },
  {
    title: 'Ask for stock and price',
    say: 'iPhone 15, 128 giqabayt, qara var? Neçəyədir?',
    expect: 'search_inventory in the trace; real price and stock.',
  },
  {
    title: 'Offer a trade-in',
    say: 'Köhnə iPhone 13-ü vermək istəyirəm. İdeal vəziyyətdədir.',
    expect: 'A photo-request card lands in WhatsApp while the call is still live.',
  },
  {
    title: 'Upload photos of a cracked phone',
    expect: 'Agent politely says the photos show a crack and prices on the photos. Amber row in the trace.',
  },
  {
    title: 'Push for more money, twice',
    say: 'Bu azdır, bir az artırın.',
    expect: 'Offer rises in small steps, then stops at +5%. negotiate_offer is_final turns amber.',
  },
  {
    title: 'Accept the accessory',
    say: 'Kabro da olsun.',
    expect: 'Product card for a case that matches the exact model.',
  },
  {
    title: 'Give a delivery address — in Russian',
    say: 'А доставка в Ясамал сколько стоит?',
    expect: 'Agent switches to Russian; calculate_delivery returns the fee.',
  },
  {
    title: 'Confirm the order',
    say: 'Razıyam, sifariş verin.',
    expect: 'Itemised order summary and a payment link appear in WhatsApp.',
  },
  {
    title: 'Claim you paid (before paying)',
    say: 'Ödədim.',
    expect: 'check_payment_status says unpaid; agent does not accept the claim.',
  },
  {
    title: 'Click “Pay” on the link, then ask again',
    say: 'İndi ödədim, yoxlayın.',
    expect: 'Demo payment page → paid. Agent confirms; ask “Sifarişim haradadır?” for tracking.',
  },
  {
    title: 'Ask for a callback',
    say: 'Mənə geri zəng edin.',
    expect: 'Call ends. ~15 s later a full-screen incoming call appears. Accept: the agent remembers everything.',
  },
  {
    title: 'Ask for a human',
    say: 'Menecerlə danışmaq istəyirəm.',
    expect: 'Handoff banner with the summary the human agent receives.',
  },
]

export function DemoScript({ onClose }: { onClose(): void }) {
  const [done, setDone] = useState<Set<number>>(new Set())
  const [openStep, setOpenStep] = useState<number | null>(0)

  const toggleDone = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else {
        next.add(i)
        setOpenStep(i + 1 < STEPS.length ? i + 1 : null)
      }
      return next
    })

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">Demo script</h2>
          <p className="text-xs text-slate-400">
            {done.size}/{STEPS.length} steps · core scenario
          </p>
        </div>
        <button onClick={onClose} className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
          Hide
        </button>
      </header>
      <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {STEPS.map((s, i) => {
          const isOpen = openStep === i
          const isDone = done.has(i)
          return (
            <li key={i} className="border-b border-slate-800/70">
              <div className="flex items-start gap-2 px-3 py-2">
                <button
                  onClick={() => toggleDone(i)}
                  aria-label={isDone ? 'Mark step not done' : 'Mark step done'}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border text-[10px] font-semibold ${
                    isDone ? 'border-emerald-400 bg-emerald-400 text-slate-950' : 'border-slate-600 text-slate-400'
                  }`}
                >
                  {isDone ? <CheckIcon className="h-3 w-3" /> : i + 1}
                </button>
                <button
                  onClick={() => setOpenStep(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 cursor-pointer items-start justify-between gap-2 text-left"
                >
                  <span className={`text-[13px] leading-snug ${isDone ? 'text-slate-500 line-through' : 'text-slate-100'}`}>
                    {s.title}
                  </span>
                  <ChevronIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 transition ${isOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {isOpen && (
                <div className="space-y-1.5 px-3 pb-3 pl-10 text-xs">
                  {s.say && (
                    <p className="rounded-md bg-emerald-500/10 px-2 py-1.5 text-emerald-200">
                      <span className="text-emerald-400/70">Say: </span>“{s.say}”
                    </p>
                  )}
                  <p className="text-slate-400">
                    <span className="text-slate-500">Expect: </span>
                    {s.expect}
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
