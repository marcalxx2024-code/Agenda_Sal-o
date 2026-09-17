import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { NavIcon, type NavIconName } from './NavIcon'

interface NavigationItem {
  label: string
  path: string
  icon: NavIconName
  end?: boolean
}

const navigation: NavigationItem[] = [
  { label: 'Início', path: '/', icon: 'home', end: true },
  { label: 'Agenda', path: '/agenda', icon: 'calendar' },
  { label: 'Clientes', path: '/clientes', icon: 'clients' },
  { label: 'Serviços', path: '/servicos', icon: 'services' },
  { label: 'Histórico', path: '/historico', icon: 'history' },
  { label: 'Retornos', path: '/retornos', icon: 'returns' },
  { label: 'Config.', path: '/configuracoes', icon: 'settings' },
]

const pageTitles: Record<string, string> = {
  '/': 'Visão geral',
  '/agenda': 'Agenda',
  '/clientes': 'Clientes',
  '/servicos': 'Serviços',
  '/historico': 'Histórico',
  '/retornos': 'Retornos',
  '/configuracoes': 'Configurações',
}

export function AppShell() {
  const { session, signOut } = useAuth()
  const location = useLocation()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  async function handleSignOut() {
    setIsSigningOut(true)
    setLogoutError(null)
    const result = await signOut()
    setLogoutError(result.error)
    setIsSigningOut(false)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="brand-mark" aria-hidden="true">
            ML
          </div>
          <div>
            <strong>Monica Lugo</strong>
            <span>Alisamentos</span>
          </div>
        </div>

        <nav className="sidebar__nav" aria-label="Navegação principal">
          {navigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `nav-link${isActive ? ' nav-link--active' : ''}`
              }
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="account-summary">
            <span className="account-summary__avatar" aria-hidden="true">
              M
            </span>
            <span className="account-summary__text">
              <strong>Conta do salão</strong>
              <small>{session?.user.email}</small>
            </span>
          </div>
          <button
            className="logout-button"
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? 'Saindo…' : 'Sair'}
          </button>
          {logoutError && (
            <p className="inline-error" role="alert">
              {logoutError}
            </p>
          )}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar__mobile-brand">
            <span className="brand-mark brand-mark--small" aria-hidden="true">
              ML
            </span>
            <span>Monica Lugo</span>
          </div>
          <div className="topbar__title">
            <span>Área interna</span>
            <h1>{pageTitles[location.pathname] ?? 'Monica Lugo'}</h1>
          </div>
          <button
            className="mobile-logout"
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            aria-label={isSigningOut ? 'Saindo da conta' : 'Sair da conta'}
          >
            {isSigningOut ? 'Saindo…' : 'Sair'}
          </button>
        </header>

        {logoutError && (
          <p className="mobile-inline-error" role="alert">
            {logoutError}
          </p>
        )}

        <main className="workspace__content">
          <Outlet />
        </main>
      </section>

      <nav className="mobile-nav" aria-label="Navegação principal">
        {navigation.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={({ isActive }) =>
              `mobile-nav__link${isActive ? ' mobile-nav__link--active' : ''}`
            }
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
