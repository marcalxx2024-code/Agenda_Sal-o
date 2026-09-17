import { lazy, Suspense } from 'react'
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ProtectedRoute, PublicOnlyRoute } from './components/RouteGuards'
import { AuthProvider } from './hooks/AuthProvider'
import { LoginPage } from './pages/LoginPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then(({ DashboardPage: page }) => ({
    default: page,
  })),
)
const AgendaPage = lazy(() =>
  import('./pages/AgendaPage').then(({ AgendaPage: page }) => ({ default: page })),
)
const ClientsPage = lazy(() =>
  import('./pages/ClientsPage').then(({ ClientsPage: page }) => ({ default: page })),
)
const ServicesPage = lazy(() =>
  import('./pages/ServicesPage').then(({ ServicesPage: page }) => ({ default: page })),
)
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then(({ HistoryPage: page }) => ({ default: page })),
)
const ReturnsPage = lazy(() =>
  import('./pages/ReturnsPage').then(({ ReturnsPage: page }) => ({ default: page })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then(({ SettingsPage: page }) => ({ default: page })),
)

function InternalRouteLoader() {
  return (
    <div className="agenda-state route-loader" role="status" aria-live="polite">
      <span className="agenda-state__pulse" aria-hidden="true" />
      <h3>Preparando esta tela…</h3>
    </div>
  )
}

function InternalRoutes() {
  return (
    <Suspense fallback={<InternalRouteLoader />}>
      <Outlet />
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route element={<InternalRoutes />}>
                <Route index element={<DashboardPage />} />
                <Route path="agenda" element={<AgendaPage />} />
                <Route path="clientes" element={<ClientsPage />} />
                <Route path="servicos" element={<ServicesPage />} />
                <Route path="historico" element={<HistoryPage />} />
                <Route path="retornos" element={<ReturnsPage />} />
                <Route path="configuracoes" element={<SettingsPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
