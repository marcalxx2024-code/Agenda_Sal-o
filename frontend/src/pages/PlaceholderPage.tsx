import { NavIcon, type NavIconName } from '../components/NavIcon'

interface PlaceholderPageProps {
  title: string
  description: string
  icon: NavIconName
}

export function PlaceholderPage({
  title,
  description,
  icon,
}: PlaceholderPageProps) {
  return (
    <section className="placeholder-page">
      <div className="placeholder-page__icon">
        <NavIcon name={icon} />
      </div>
      <span className="eyebrow">Próxima etapa</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <span className="placeholder-page__status">
        Estrutura preparada · funcionalidade ainda não implementada
      </span>
    </section>
  )
}
