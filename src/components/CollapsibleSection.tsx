import { useState } from 'react'

type CollapsibleSectionProps = {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export function CollapsibleSection({ title, subtitle, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="collapsible-section no-print">
      <button className="collapsible-header" onClick={() => setOpen(!open)}>
        <span className="collapsible-title">{title}</span>
        {subtitle && <span className="collapsible-subtitle">{subtitle}</span>}
        <span className="collapsible-toggle">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="collapsible-content">{children}</div>}
    </section>
  )
}
