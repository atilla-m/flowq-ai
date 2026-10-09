import type { ReactNode } from 'react'

/** Shared device chrome for the two customer-facing screens. */
export function PhoneFrame({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <section className={`phone-device ${className}`} aria-label={label}>
      <span className="phone-side-button" aria-hidden />
      <span className="phone-power-button" aria-hidden />
      <div className="phone-screen">
        <div className="phone-status-bar" aria-hidden>
          <span>9:41</span>
          <span className="phone-notch"><i /></span>
          <span className="phone-status-icons">
            <svg aria-hidden="true" viewBox="0 0 18 12"><path d="M1 11V8h2v3ZM5 11V6h2v5ZM9 11V3h2v8ZM13 11V0h2v11Z" fill="currentColor" /></svg>
            <svg aria-hidden="true" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1 3a10 10 0 0 1 14 0M4 6a6 6 0 0 1 8 0M7 9a2 2 0 0 1 2 0" /><circle cx="8" cy="11" r=".65" fill="currentColor" stroke="none" /></svg>
            <svg aria-hidden="true" viewBox="0 0 25 12" fill="none" stroke="currentColor"><rect x=".5" y=".5" width="21" height="11" rx="3" /><rect x="3" y="3" width="16" height="6" rx="1" fill="currentColor" stroke="none" /><path d="M23 4v4" strokeWidth="2" /></svg>
          </span>
        </div>
        {children}
        <div className="phone-home-bar" aria-hidden><span /></div>
      </div>
    </section>
  )
}
