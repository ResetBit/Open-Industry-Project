import type { TagValue } from '../../plc/types'
import type { LiveTrainingRun, TrainingEvent, TrainingSample } from './records'

export type AlarmRule = number | true | null

export interface MonitorSignal {
  tag: string
  alarm: AlarmRule
}

export const MAX_SAMPLES = 2400

export interface RunningRecord extends Omit<LiveTrainingRun, 'finishedAt'> {
  serial: number
  paused: boolean
  activeAlarms: Map<string, boolean>
  signals: MonitorSignal[]
}

export function startRecording(header: Pick<LiveTrainingRun, 'documentId' | 'project' | 'student'>, serial: number, startedAt: number, seconds: number, signals: readonly MonitorSignal[]): RunningRecord {
  return {
    ...header, kind: 'live', startedAt, serial, paused: false, signals: signals.map((s) => ({ ...s })), activeAlarms: new Map(),
    samples: [], events: [{ kind: 'start', seconds }], totalSamples: 0,
  }
}

export function advanceRecording(run: RunningRecord, paused: boolean, seconds: number, image: Readonly<Record<string, TagValue>>): void {
  if (run.paused !== paused) {
    run.paused = paused
    run.events.push({ kind: paused ? 'pause' : 'resume', seconds })
  }
  if (run.samples.at(-1)?.seconds === seconds) return
  const values = Object.fromEntries(run.signals.flatMap(({ tag }) => {
    const value = Object.hasOwn(image, tag) ? image[tag] : undefined
    return value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? [] : [[tag, value]]
  }))
  if (Object.keys(values).length === 0) return
  const sample: TrainingSample = { seconds, values }
  run.samples.push(sample)
  run.totalSamples++
  if (run.samples.length > MAX_SAMPLES) run.samples.shift()
  for (const { tag, alarm } of run.signals) {
    if (!Object.hasOwn(values, tag)) continue
    const value = values[tag]
    const isAlarm = alarm === true ? value === true : typeof alarm === 'number' && typeof value === 'number' && value > alarm
    const wasAlarm = run.activeAlarms.has(tag)
    if (wasAlarm === isAlarm) continue
    if (isAlarm) run.activeAlarms.set(tag, false)
    else run.activeAlarms.delete(tag)
    run.events.push({ kind: isAlarm ? 'alarm' : 'clear', seconds, tag, value })
  }
}

export function acknowledgeAlarm(run: RunningRecord, tag: string, seconds: number): void {
  if (run.activeAlarms.get(tag) !== false) return
  run.activeAlarms.set(tag, true)
  run.events.push({ kind: 'acknowledge', seconds, tag })
}

export function finishRecording(run: RunningRecord, finishedAt: number, seconds: number): LiveTrainingRun {
  const { documentId, project, student, startedAt, samples, events, totalSamples } = run
  const stop: TrainingEvent = { kind: 'stop', seconds: Math.max(samples.at(-1)?.seconds ?? 0, seconds) }
  return { kind: 'live', documentId, project, student, startedAt, finishedAt, samples, events: [...events, stop], totalSamples }
}
