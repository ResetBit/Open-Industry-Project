import { describe, expect, it } from 'vitest'
import { acknowledgeAlarm, advanceRecording, finishRecording, startRecording } from './recording'

describe('workstation training recording', () => {
  it('records a once-only alarm and acknowledgment, pause/resume, and stop for the same project', () => {
    const run = startRecording({ documentId: 'p', project: 'Station', student: 'Learner' }, 1, 1000, 0, [
      { tag: 'JamAlarm', alarm: true }, { tag: 'Count', alarm: 3 },
    ])
    advanceRecording(run, false, 0, { JamAlarm: false, Count: 1 })
    advanceRecording(run, false, 1, { JamAlarm: true, Count: 4 })
    acknowledgeAlarm(run, 'JamAlarm', 1)
    acknowledgeAlarm(run, 'JamAlarm', 1)
    advanceRecording(run, true, 1, { JamAlarm: true, Count: 4 })
    advanceRecording(run, false, 2, { JamAlarm: false, Count: 2 })
    const record = finishRecording(run, 3000, 2)
    expect(record.documentId).toBe('p')
    expect(record.samples).toHaveLength(3)
    expect(record.events.map((e) => e.kind)).toEqual(['start', 'alarm', 'alarm', 'acknowledge', 'pause', 'resume', 'clear', 'clear', 'stop'])
    expect(run.activeAlarms.size).toBe(0)
  })
})
