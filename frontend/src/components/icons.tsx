import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (p: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
})

export const PhoneIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.100 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.900.7 2.800a2 2 0 0 1-.5 2.100L8.100 9.900a16 16 0 0 0 6 6l1.300-1.300a2 2 0 0 1 2.100-.4c.9.3 1.800.6 2.800.7a2 2 0 0 1 1.700 2z" />
  </svg>
)

export const HangupIcon = ({ className = '', ...p }: P) => <PhoneIcon {...p} className={`rotate-[135deg] ${className}`} />

export const MicIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
  </svg>
)

export const SendIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m22 2-7 20-4-9-9-4zM22 2 11 13" />
  </svg>
)

export const WhatsAppIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3 21l1.5-5A8.5 8.5 0 1 1 20.5 11.5Z" />
    <path d="M8 7.5c-.7 2.9 2.2 6.4 5.6 7.9l1.9-1.5-2.3-1.5-1.1 1-2.7-2.8.8-1.3Z" />
  </svg>
)

export const ClipIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m21.400 11.100-9.200 9.200a6 6 0 0 1-8.500-8.500l9.200-9.200a4 4 0 0 1 5.700 5.700l-9.200 9.200a2 2 0 0 1-2.800-2.800l8.500-8.500" />
  </svg>
)

export const CameraIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

export const ChevronIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export const WrenchIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.700 6.300a4 4 0 0 0 5 5l-9.400 9.400a2.100 2.100 0 0 1-3-3zM14.700 6.300l2.800-2.800a6 6 0 0 0-7.800 7.800" />
  </svg>
)

export const ShieldIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)

export const ListIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
)

export const UserIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

export const SearchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

export const SunIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const MoonIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

export const TruckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M1 5h13v11H1zM14 9h4l4 4v3h-8z" />
    <circle cx="6" cy="18.5" r="2" />
    <circle cx="18" cy="18.5" r="2" />
  </svg>
)

export const ReceiptIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6" />
  </svg>
)

export const CardIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M2 10h20" />
  </svg>
)

export const PackageIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" />
  </svg>
)

export const TagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 3h8l10 10-8 8L3 11zM7.5 7.500h.01" />
  </svg>
)

export const TrendIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />
  </svg>
)

export const BagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 7h12l1 14H5zM9 7V5a3 3 0 0 1 6 0v2" />
  </svg>
)

export const ScanIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export const ClockIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const ExpandIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
  </svg>
)

export const BoltIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </svg>
)

export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="10" fill="#1252ee" />
      <path d="M8 16h2.500M13 11v10M16.500 7.500v17M20 12v8M24 14.500v3" stroke="#fff" strokeWidth="2.400" strokeLinecap="round" fill="none" />
    </svg>
  )
}
