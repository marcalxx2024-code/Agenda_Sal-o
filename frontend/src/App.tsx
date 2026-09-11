import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ProtectedRoute, PublicOnlyRoute } from './components/RouteGuards'
import { AuthProvider } from './hooks/AuthProvider'
import { ClientsPage } from './pages/ClientsPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { ServicesPage } from './pages/ServicesPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route
                path="agenda"
                element={
                  <PlaceholderPage
                    title="Agenda"
                    description="A visão diária e semanal dos agendamentos será construída aqui."
                    icon="calendar"
                  />
                }
              />
              <Route path="clientes" element={<ClientsPage />} />
              <Route path="servicos" element={<ServicesPage />} />
              <Route
                path="retornos"
                element={
                  <PlaceholderPage
                    title="Retornos"
                    description="Os avisos para contato e o acompanhamento dos retornos ficarão aqui."
                    icon="returns"
                  />
                }
              />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
