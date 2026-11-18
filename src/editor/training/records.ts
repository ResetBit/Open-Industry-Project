import type { TagValue } from '../../plc/types'

export interface TrainingSample {
  seconds: number
  values: Record<string, TagValue>
}

export interface TrainingEvent {
  seconds: number
  kind: 'start' | 'pause' | 'resume' | 'stop' | 'alarm' | 'clear' | 'acknowledge'
  tag?: string
  value?: TagValue
}

interface RecordHeader {
  documentId: string
  project: string
  student: string
  startedAt: number
  finishedAt: number
}

export interface LiveTrainingRun extends RecordHeader {
  kind: 'live'
  samples: TrainingSample[]
  events: TrainingEvent[]
  totalSamples: number
}

export interface TestTrainingRun extends RecordHeader {
  kind: 'test'
  results: { name: string; ok: boolean; checks: { ok: boolean; detail: string }[]; error?: string; flow?: string }[]
  error?: string
}

export type TrainingRun = LiveTrainingRun | TestTrainingRun
export type SavedTrainingRun = TrainingRun & { id: string }

const STORE = 'runs'
const INDEX = 'documentAndTime'
const DATABASE = 'oip-workstation-training'

function openRecords(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      const table = request.result.createObjectStore(STORE, { keyPath: 'id' })
      table.createIndex(INDEX, ['documentId', 'finishedAt'])
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Training records are blocked'))
  })
}

export async function saveTrainingRun(run: TrainingRun): Promise<SavedTrainingRun> {
  const record = { ...run, id: crypto.randomUUID() }
  const db = await openRecords()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      tx.objectStore(STORE).add(record)
    })
    return record
  } finally {
    db.close()
  }
}

export async function listTrainingRuns(documentId: string, start: number, end: number): Promise<SavedTrainingRun[]> {
  const db = await openRecords()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const filter = IDBKeyRange.bound([documentId, start], [documentId, end])
      const request = tx.objectStore(STORE).index(INDEX).openCursor(filter, 'prev')
      const records: SavedTrainingRun[] = []
      tx.oncomplete = () => resolve(records)
      tx.onabort = () => reject(tx.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        records.push(cursor.value as SavedTrainingRun)
        if (records.length < 50) cursor.continue()
      }
    })
  } finally {
    db.close()
  }
}

export function downloadTrainingRun(run: TrainingRun): void {
  const blob = new Blob([JSON.stringify({ version: 1, ...run }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'workstation-training-' + new Date(run.finishedAt).toISOString().slice(0, 10) + '.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
