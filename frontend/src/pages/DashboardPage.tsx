const overviewItems = [
  {
    label: 'Agendamentos de hoje',
    value: '—',
    note: 'A agenda será conectada na próxima etapa.',
    tone: 'rose',
  },
  {
    label: 'Retornos pendentes',
    value: '—',
    note: 'Os dados reais ainda não estão carregados.',
    tone: 'sand',
  },
  {
    label: 'Próximo atendimento',
    value: '—',
    note: 'Horário e cliente aparecerão aqui.',
    tone: 'olive',
  },
]

export function DashboardPage() {
  return (
    <div className="dashboard-page">
      <section className="welcome-block">
        <div>
          <span className="eyebrow">Base do painel · dados ilustrativos</span>
          <h2>Uma visão tranquila do seu dia.</h2>
          <p>
            Esta primeira versão prepara a navegação. Os indicadores serão
            conectados ao salão nas próximas etapas.
          </p>
        </div>
        <div className="welcome-block__detail" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="overview-section" aria-labelledby="overview-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Resumo</span>
            <h3 id="overview-title">Hoje no salão</h3>
          </div>
          <span className="placeholder-badge">Visual inicial</span>
        </div>

        <div className="overview-grid">
          {overviewItems.map((item) => (
            <article
              className={`overview-card overview-card--${item.tone}`}
              key={item.label}
            >
              <span className="overview-card__label">{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cycle-panel" aria-labelledby="cycle-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Fluxo principal</span>
            <h3 id="cycle-title">Do agendamento ao próximo cuidado</h3>
          </div>
        </div>
        <ol className="cycle-list">
          <li><span>01</span>Agendamento</li>
          <li><span>02</span>Atendimento</li>
          <li><span>03</span>Procedimento</li>
          <li><span>04</span>Retorno</li>
          <li><span>05</span>Novo agendamento</li>
        </ol>
      </section>
    </div>
  )
}
