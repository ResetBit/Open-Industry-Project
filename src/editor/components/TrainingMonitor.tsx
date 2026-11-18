import { useCallback, useEffect, useRef, useState } from 'react'
import { defineMessages, t } from '../../core/i18n'
import type { TagValue } from '../../plc/types'
import { commandEnabled, runCommand } from '../commands'
import type { EditorController } from '../controller'
import { currentDocumentId } from '../project/documentStore'
import type { EditorState, EditorStore } from '../store/store'
import { acknowledgeAlarm, advanceRecording, finishRecording, startRecording } from '../training/recording'
import type { MonitorSignal, RunningRecord } from '../training/recording'
import { downloadTrainingRun, listTrainingRuns, saveTrainingRun } from '../training/records'
import type { LiveTrainingRun, SavedTrainingRun, TrainingSample } from '../training/records'
import { CloseIcon } from './toolbarIcons'
import { WorkcellInspection } from './WorkcellInspection'

const M = defineMessages('trainingMonitor', {
  title: 'Run & verify',
  close: 'Close',
  running: 'Simulation running',
  paused: 'Simulation paused',
  stopped: 'Simulation stopped',
  run: 'Run',
  pause: 'Pause / resume',
  step: 'Step',
  stop: 'Stop',
  tests: 'Run project tests',
  watch: 'Live signals',
  student: 'Learner name or number',
  tag: 'Signal',
  value: 'Value',
  alarmRule: 'Alarm rule',
  alarmOff: 'Off',
  alarmOn: 'When TRUE',
  alarmAbove: 'Above a number',
  removeSignal: 'Remove {tag}',
  add: 'Add a PLC signal',
  noSignals: 'Run the PLC to see the available signals.',
  record: 'Record this run',
  recordEnd: 'Finish and save record',
  armed: 'Recording is armed. Start the simulation.',
  recording: 'Recording the running simulation.',
  saved: 'Record saved on this computer.',
  saveError: 'Could not save this record. Download it to keep a copy.',
  empty: 'No records in this date range.',
  queryError: 'Could not load the local records.',
  history: 'Run history',
  from: 'From',
  to: 'To',
  download: 'Download JSON report',
  realtime: 'Live record',
  validation: 'Project test result',
  event: 'Event log',
  eventStart: 'Recording started',
  eventPause: 'Simulation paused',
  eventResume: 'Simulation resumed',
  eventStop: 'Recording finished',
  eventAlarm: 'Alarm raised',
  eventClear: 'Alarm returned to normal',
  eventAck: 'Alarm acknowledged',
  acknowledge: 'Acknowledge',
  acknowledged: 'Acknowledged',
  trend: 'Trend',
  sampleCount: { one: '{count} sample', other: '{count} samples' },
  tail: 'The trend and report keep the latest {count} samples and all recorded events.',
  operator: 'Workstation operator panel',
  operatorStart: 'Start batch',
  operatorPause: 'Hold / continue batch',
  operatorWait: 'Ready',
  operatorBusy: 'Working',
  operatorHeld: 'Held',
  operatorDone: 'Batch complete',
  operatorFault: 'Fault',
  operatorCount: 'Parts out: {count}',
  operatorJobs: 'Completed jobs: {count}',
})

const eventLabels = {
  start: M.eventStart, pause: M.eventPause, resume: M.eventResume, stop: M.eventStop,
  alarm: M.eventAlarm, clear: M.eventClear, acknowledge: M.eventAck,
}
const operatorModes = [M.operatorWait, M.operatorBusy, M.operatorHeld, M.operatorDone, M.operatorFault]

function readStudent(): string {
  try { return localStorage.getItem('oip-web/training-student') ?? '' } catch { return '' }
}

function trend(samples: readonly TrainingSample[], tag: string): string {
  const values = samples.flatMap((sample) => {
    const value = sample.values[tag]
    return typeof value === 'number' || typeof value === 'boolean' ? [{ x: sample.seconds, y: Number(value) }] : []
  })
  if (values.length < 2) return ''
  const lo = Math.min(...values.map((value) => value.y))
  const hi = Math.max(...values.map((value) => value.y))
  const start = values[0]!.x
  const duration = Math.max(0.01, values.at(-1)!.x - start)
  return values.map(({ x, y }) => `${5 + 310 * (x - start) / duration},${70 - 65 * (y - lo) / Math.max(hi - lo, 1e-9)}`).join(' ')
}

interface MonitorProps {
  store: EditorStore
  state: EditorState
  controller: EditorController
  open: boolean
  onClose: () => void
}

export function TrainingMonitor({ store, state, controller, open, onClose }: MonitorProps) {
  const [signals, setSignals] = useState<MonitorSignal[]>([])
  const [student, setStudent] = useState(readStudent)
  const [armed, setArmed] = useState(false)
  const [image, setImage] = useState<Readonly<Record<string, TagValue>>>({})
  const [renderVersion, updateRender] = useState(0)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [records, setRecords] = useState<SavedTrainingRun[]>([])
  const [notice, setNotice] = useState<'saved' | 'error' | null>(null)
  const [queryError, setQueryError] = useState(false)
  const [lastRecord, setLastRecord] = useState<LiveTrainingRun | null>(null)
  const [operatorError, setOperatorError] = useState<string | null>(null)
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const active = useRef<RunningRecord | null>(null)
  const documentId = currentDocumentId() ?? 'working-copy'
  const pulse = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedRecord = records.find((record) => record.id === selectedRecordId)

  const refresh = useCallback(async () => {
    const start = from === '' ? 0 : new Date(from + 'T00:00:00').getTime()
    const end = to === '' ? Number.MAX_SAFE_INTEGER : new Date(to + 'T23:59:59.999').getTime()
    try {
      setRecords(start <= end ? await listTrainingRuns(documentId, start, end) : [])
      setQueryError(false)
    } catch {
      setQueryError(true)
    }
  }, [documentId, from, to])

  const finish = useCallback(() => {
    const run = active.current
    active.current = null
    setArmed(false)
    if (!run) return
    const result = finishRecording(run, Date.now(), controller.lastFrame?.simTime ?? 0)
    setLastRecord(result)
    setNotice(null)
    void saveTrainingRun(result).then(() => {
      setNotice('saved')
      void refresh()
    }, () => setNotice('error'))
  }, [controller, refresh])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open && !armed) return
    function tick() {
      const now = store.getState()
      const values = controller.plcWatch ?? {}
      const frame = controller.lastFrame
      if (open) setImage(values)
      const run = active.current
      if (run && (!now.running || run.serial !== controller.runSerial)) {
        finish()
        return
      }
      if (!armed || !now.running || !frame) return
      if (active.current === null) {
        active.current = startRecording({ documentId, project: now.projectName, student: student.trim() }, controller.runSerial, Date.now(), frame.simTime, signals)
      }
      advanceRecording(active.current, now.paused, frame.simTime, values)
      if (open) updateRender((version) => version + 1)
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [armed, open, store, controller, documentId, student, signals, finish])

  useEffect(() => () => {
    if (pulse.current !== null) clearTimeout(pulse.current)
  }, [controller])

  useEffect(() => {
    if (!open) return
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!(event.target instanceof Element) || !event.target.closest('[data-training-monitor]')) return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', keyDown, true)
    return () => window.removeEventListener('keydown', keyDown, true)
  }, [open, onClose])

  if (!open) return null

  const tags = Object.keys(image).sort()
  const available = tags.filter((tag) => !signals.some((item) => item.tag === tag))
  const shown = active.current ?? (selectedRecord?.kind === 'live' ? selectedRecord : lastRecord)
  const activeAlarms = active.current?.activeAlarms
  const operators = state.running && !state.readOnly && Object.hasOwn(controller.plcProgramWatch ?? {}, 'TestStart')
    && Object.hasOwn(controller.plcProgramWatch ?? {}, 'TestPause') && Object.hasOwn(image, 'PanelMode')

  function updateSignal(tag: string, alarm: MonitorSignal['alarm']) {
    setSignals((items) => items.map((entry) => entry.tag === tag ? { tag, alarm } : entry))
  }

  function startBatch() {
    if (pulse.current !== null) return
    const error = controller.writePlcValue('TestStart', 'true')
    setOperatorError(error)
    if (error !== null) return
    const serial = controller.runSerial
    pulse.current = setTimeout(() => {
      pulse.current = null
      if (controller.runSerial === serial) setOperatorError(controller.writePlcValue('TestStart', 'false'))
    }, Math.max(120, store.getState().stScanMs * 3))
  }

  function pauseBatch() {
    setOperatorError(controller.writePlcValue('TestPause', String(image.TestPause !== true)))
  }

  return (
    <aside className="training-window" aria-labelledby="training-monitor-title" data-training-monitor data-version={renderVersion}>
      <div className="author-head">
        <h2 id="training-monitor-title">{t(M.title)}</h2>
        <button type="button" className="author-close" aria-label={t(M.close)} onClick={onClose}><CloseIcon /></button>
      </div>
      <p>{t(state.running ? state.paused ? M.paused : M.running : M.stopped)}</p>
      <div className="training-actions">
        {([['sim.run', M.run], ['sim.pause', M.pause], ['sim.step', M.step], ['sim.stop', M.stop], ['sim.runTests', M.tests]] as const).map(([command, label]) => (
          <button type="button" key={command} disabled={!commandEnabled(command)} onClick={() => {
            if (command === 'sim.runTests') onClose()
            runCommand(command)
          }}>{t(label)}</button>
        ))}
      </div>
      {operators && (
        <section className="training-section">
          <h3>{t(M.operator)}</h3>
          <p data-testid="training-operator-status">{t(operatorModes[Number(image.PanelMode)] ?? M.operatorWait)} · {t(M.operatorCount, { count: Number(image.OutCount ?? 0) })} · {t(M.operatorJobs, { count: Number(image.CompletedJobs ?? 0) })}</p>
          <div className="training-actions">
            <button type="button" data-testid="training-operator-start" disabled={state.paused || Number(image.PanelMode) !== 0} onClick={startBatch}>{t(M.operatorStart)}</button>
            <button type="button" disabled={state.paused || ![1, 2].includes(Number(image.PanelMode))} onClick={pauseBatch}>{t(M.operatorPause)}</button>
          </div>
          {operatorError && <p role="alert">{operatorError}</p>}
        </section>
      )}
      <WorkcellInspection store={store} state={state} controller={controller} />
      <section className="training-section">
        <h3>{t(M.watch)}</h3>
        <label className="training-field">
          {t(M.student)}
          <input value={student} maxLength={48} disabled={armed} onChange={(event) => {
            setStudent(event.target.value)
            try { localStorage.setItem('oip-web/training-student', event.target.value) } catch { /* local preference */ }
          }} />
        </label>
        <select
          aria-label={t(M.add)}
          data-testid="training-add-signal"
          value=""
          disabled={armed || signals.length >= 8 || available.length === 0}
          onChange={(event) => {
            if (event.target.value) setSignals((items) => [...items, { tag: event.target.value, alarm: null }])
          }}
        >
          <option value="">{t(M.add)}</option>
          {available.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        {tags.length === 0 && <p>{t(M.noSignals)}</p>}
        {signals.length > 0 && (
          <table>
            <thead><tr><th>{t(M.tag)}</th><th>{t(M.value)}</th><th>{t(M.alarmRule)}</th><th /></tr></thead>
            <tbody>
              {signals.map(({ tag, alarm }) => {
                const acknowledged = activeAlarms?.get(tag)
                return (
                  <tr key={tag}>
                    <th scope="row">{tag}</th>
                    <td>{String(Object.hasOwn(image, tag) ? image[tag] : '—')}</td>
                    <td>
                      <select
                        aria-label={t(M.alarmRule) + ' ' + tag}
                        disabled={armed}
                        value={alarm === true ? 'true' : alarm === null ? 'off' : 'above'}
                        onChange={(event) => updateSignal(tag, event.target.value === 'true' ? true : event.target.value === 'above' ? 0 : null)}
                      >
                        <option value="off">{t(M.alarmOff)}</option>
                        <option value="true">{t(M.alarmOn)}</option>
                        <option value="above">{t(M.alarmAbove)}</option>
                      </select>
                      {typeof alarm === 'number' && (
                        <input type="number" step="any" aria-label={t(M.alarmAbove) + ' ' + tag} value={alarm} disabled={armed}
                          onChange={(event) => {
                            if (Number.isFinite(event.target.valueAsNumber)) updateSignal(tag, event.target.valueAsNumber)
                          }} />
                      )}
                      {acknowledged !== undefined && (
                        <button type="button" disabled={acknowledged} onClick={() => {
                          if (!active.current) return
                          acknowledgeAlarm(active.current, tag, controller.lastFrame?.simTime ?? 0)
                          updateRender((version) => version + 1)
                        }}>{t(acknowledged ? M.acknowledged : M.acknowledge)}</button>
                      )}
                    </td>
                    <td><button type="button" aria-label={t(M.removeSignal, { tag })} disabled={armed} onClick={() => setSignals((items) => items.filter((signal) => signal.tag !== tag))}>×</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="training-actions">
          {armed ? (
            <button type="button" data-testid="training-finish-record" onClick={finish}>{t(M.recordEnd)}</button>
          ) : (
            <button type="button" data-testid="training-record" disabled={signals.length === 0} onClick={() => {
              setNotice(null)
              setSelectedRecordId(null)
              setArmed(true)
            }}>{t(M.record)}</button>
          )}
          {lastRecord && <button type="button" onClick={() => downloadTrainingRun(lastRecord)}>{t(M.download)}</button>}
        </div>
        {armed && <p role="status">{t(state.running ? M.recording : M.armed)}</p>}
        {notice && <p role="status">{t(notice === 'saved' ? M.saved : M.saveError)}</p>}
        {shown && (
          <>
            <p>{t(M.sampleCount, { count: shown.totalSamples })}</p>
            {shown.totalSamples > shown.samples.length && <p>{t(M.tail, { count: shown.samples.length })}</p>}
            {Object.keys(shown.samples[0]?.values ?? {}).map((tag) => {
              const points = trend(shown.samples, tag)
              return points ? (
                <figure key={tag}>
                  <figcaption>{t(M.trend)} · {tag}</figcaption>
                  <svg aria-hidden="true" viewBox="0 0 320 75" width="100%">
                    <path d="M5 3 V70 H315" fill="none" stroke="currentColor" opacity=".3" />
                    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </figure>
              ) : null
            })}
            <details>
              <summary>{t(M.event)}</summary>
              <ol>{shown.events.map((event, index) => (
                <li key={index}>{event.seconds.toFixed(2)} s · {t(eventLabels[event.kind])}{event.tag ? ' · ' + event.tag : ''}{event.value !== undefined ? ' = ' + String(event.value) : ''}</li>
              ))}</ol>
            </details>
          </>
        )}
      </section>
      <section className="training-section">
        <h3>{t(M.history)}</h3>
        <div className="training-field">
          <label>{t(M.from)} <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>{t(M.to)} <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
        {queryError ? <p role="alert">{t(M.queryError)}</p> : records.length === 0 ? <p>{t(M.empty)}</p> : (
          <ul>{records.map((record) => (
            <li key={record.id}>
              <button type="button" disabled={record.kind !== 'live' || armed} onClick={() => setSelectedRecordId(record.id)}>
                {new Date(record.finishedAt).toLocaleString()} · {t(record.kind === 'live' ? M.realtime : M.validation)}{record.student ? ' · ' + record.student : ''}
              </button>
              {' '}
              <button type="button" onClick={() => downloadTrainingRun(record)}>{t(M.download)}</button>
            </li>
          ))}</ul>
        )}
      </section>
    </aside>
  )
}
