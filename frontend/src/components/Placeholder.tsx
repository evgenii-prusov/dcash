import { Ic, type IconName } from './Icon'

/** Stand-in view used while a section's real epic has not landed yet. */
export function Placeholder({ icon, title, sub, text }: { icon: IconName; title: string; sub: string; text: string }) {
  return (
    <>
      <div className="ph">
        <div>
          <div className="ph-title">{title}</div>
          <div className="ph-sub">{sub}</div>
        </div>
      </div>
      <div className="card">
        <div className="empty">
          <div className="empty-icon">
            <Ic n={icon} s={34} c="var(--text-3)" />
          </div>
          <div className="text-[13px]">{text}</div>
        </div>
      </div>
    </>
  )
}
