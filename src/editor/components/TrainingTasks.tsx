import { useRef, useState } from 'react'
import { defineMessages, t } from '../../core/i18n'
import { LESSONS, openTrainingLesson } from '../training/lessons'
import type { Lesson } from '../training/lessons'
import type { EditorStore } from '../store/store'
import { trapTab, useModalKeys } from './inspector/menu'
import { CloseIcon } from './toolbarIcons'
import type { EditorController } from '../controller'
import { importPartFiles } from '../parts/importPartFiles'
import cylinderPackage from '../../../examples/training-parts/pneumatic-cylinder/双作用气缸.part.json?raw'

const M = defineMessages('trainingTasks', {
  title: 'Training tasks',
  close: 'Close',
  start: 'Open a training copy',
  loading: 'Opening…',
  expected: 'Expected result',
  needStop: 'Stop the simulation before opening another task.',
  cylinder: 'Import a double-acting cylinder',
  cylinderError: 'Could not read the training cylinder.',
})

export function TrainingTasks({ store, controller, onClose, activeLesson }: {
  store: EditorStore
  controller: EditorController | null
  onClose: () => void
  activeLesson: Lesson['id'] | undefined
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<Lesson['id'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const running = store.getState().running
  useModalKeys(onClose, (event) => { if (dialog.current) trapTab(dialog.current, event) })

  async function start(lesson: Lesson) {
    setBusy(lesson.id)
    setError(null)
    const failure = await openTrainingLesson(store, lesson)
    if (failure) {
      setError(failure)
      setBusy(null)
    }
  }

  async function addCylinder() {
    if (!controller || store.getState().running || store.getState().readOnly) return
    setImporting(true)
    setError(null)
    try {
      const part = new File([cylinderPackage], 'pneumatic-cylinder.part.json', { type: 'application/json' })
      await importPartFiles(controller, [part])
      store.revealPanel('catalog')
      onClose()
    } catch {
      setError(t(M.cylinderError))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="author-backdrop" onPointerDown={onClose} data-testid="training-tasks-window">
      <div ref={dialog} className="author-dialog training-tasks" role="dialog" aria-modal="true" aria-labelledby="training-tasks-title" onPointerDown={(event) => event.stopPropagation()}>
        <div className="author-head">
          <h2 id="training-tasks-title">{t(M.title)}</h2>
          <button type="button" aria-label={t(M.close)} className="author-close" onClick={onClose}><CloseIcon /></button>
        </div>
        {running && <p>{t(M.needStop)}</p>}
        {error && <p role="alert" className="test-run-error">{error}</p>}
        <button type="button" data-testid="training-import-cylinder" disabled={!controller || running || importing || store.getState().readOnly} onClick={() => void addCylinder()}>{t(M.cylinder)}</button>
        {LESSONS.map((lesson) => (
          <details className="training-section" key={lesson.id} open={lesson.id === (activeLesson ?? 'bearing') || undefined}>
            <summary>{t(lesson.name)}</summary>
            <p>{t(lesson.brief)}</p>
            <p>{t(lesson.step)}</p>
            <p><strong>{t(M.expected)}</strong> {t(lesson.check)}</p>
            <button type="button" data-testid={'training-open-' + lesson.id} disabled={running || busy !== null} onClick={() => void start(lesson)}>
              {t(busy === lesson.id ? M.loading : M.start)}
            </button>
          </details>
        ))}
      </div>
    </div>
  )
}
