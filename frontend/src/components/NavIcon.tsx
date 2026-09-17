export type NavIconName =
  | 'home'
  | 'calendar'
  | 'clients'
  | 'services'
  | 'history'
  | 'returns'

interface NavIconProps {
  name: NavIconName
}

export function NavIcon({ name }: NavIconProps) {
  const paths: Record<NavIconName, React.ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v11h14V9M9 20v-6h6v6" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),
    clients: (
      <>
        <circle cx="9" cy="8" r="4" />
        <path d="M2.5 21a6.5 6.5 0 0 1 13 0M16 4.5a4 4 0 0 1 0 7.5M17 15a6 6 0 0 1 4.5 6" />
      </>
    ),
    services: (
      <>
        <path d="M6 3v5a6 6 0 0 0 12 0V3M5 21h14" />
        <path d="M12 14v7" />
      </>
    ),
    history: (
      <>
        <path d="M4 5h16v16H4z" />
        <path d="M8 3v4M16 3v4M8 11h8M8 15h5" />
      </>
    ),
    returns: (
      <>
        <path d="M20 11a8 8 0 1 0-2.3 5.7" />
        <path d="M20 4v7h-7" />
      </>
    ),
  }

  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
