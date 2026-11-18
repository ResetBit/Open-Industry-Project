import { defineMessages, t } from '../../core/i18n'
import './training.css'

const M = defineMessages('trainingBar', {
  label: 'Workstation training',
  tasks: 'Training tasks',
  design: 'Workstation design',
  teach: 'Robot teaching',
  signals: 'PLC / Signals',
  vision: 'Machine vision',
  verify: 'Run & verify',
})

const sections = ['tasks', 'design', 'teach', 'signals', 'vision', 'verify'] as const
export type TrainingSection = (typeof sections)[number]

export function TrainingToolbar({ active, onSelect, ready }: {
  active: TrainingSection
  onSelect: (section: TrainingSection) => void
  ready: boolean
}) {
  return (
    <nav className="training-bar" aria-label={t(M.label)}>
      {sections.map((section) => (
        <button
          key={section}
          type="button"
          aria-pressed={section === active}
          data-testid={'training-' + section}
          disabled={!ready && section !== 'tasks'}
          onClick={() => onSelect(section)}
        >{t(M[section])}</button>
      ))}
    </nav>
  )
}
