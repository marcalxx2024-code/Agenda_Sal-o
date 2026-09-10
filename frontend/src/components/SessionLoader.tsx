export function SessionLoader() {
  return (
    <main className="session-loader" aria-busy="true" aria-live="polite">
      <div className="brand-mark brand-mark--loader" aria-hidden="true">
        ML
      </div>
      <p>Preparando sua agenda…</p>
    </main>
  )
}
