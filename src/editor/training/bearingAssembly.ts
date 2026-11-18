import { defineMessages, t } from '../../core/i18n'
import type { ProjectJSON } from '../../core/project/project'
import type { TestSpec } from '../../core/project/projectTest'

const M = defineMessages('bearingAssembly', {
  name: 'Bearing placement on a locating fixture',
  target: 'Assembly locating fixture',
  job: 'Pick bearing and seat it',
  test: 'Lift the bearing and seat it on the locating fixture',
})

/** Reuse the load cell's taught poses to move a bearing onto a verified, empty locating fixture. */
export function assembleBearingLesson(project: ProjectJSON): ProjectJSON {
  const arm = project.scene.parts.find((part) => part.type === 'part' && part.id === 'arm')
  const fixture = project.scene.parts.find((part) => part.id === 'fixture_3')
  if (!arm || arm.type !== 'part' || !fixture || !Array.isArray(arm.params.jobs)) throw new Error('Bearing cell fixture is missing')
  const jobs = (arm.params.jobs as number[][]).filter((row) => row[0] === 0).map((row) => {
    if (row[1] !== 1) return row
    const waypoint = row[2] === 7 ? 5 : row[2] === 8 ? 6 : row[2]
    return [row[0]!, row[1]!, waypoint!, row[3]!]
  })
  const program = project.stProgram
  const stProgram = program?.replace('IF ArmIdle AND (OutCount >= SelectedJob) THEN', 'IF ArmIdle THEN')
    .replace('IF CompletedJobs = 3 THEN', 'IF CompletedJobs = 1 THEN')
    .replace('BeltRun := Active AND NOT Paused;', 'BeltRun := FALSE;')
  if (!stProgram?.includes('CompletedJobs = 1') || !stProgram.includes('BeltRun := FALSE;')) {
    throw new Error('Bearing cell PLC template changed')
  }
  const [x, y, z] = fixture.position
  const test: TestSpec = {
    name: t(M.test), duration: 25,
    inputs: [{ at: 1, tag: 'TestStart', value: true }, { at: 1.25, tag: 'TestStart', value: false }],
    checks: [
      { eventually: true, probe: { pose: { part: 'bearing_1', axis: 'y' } }, min: y + 0.28 },
      { at: 24, probe: { pose: { part: 'bearing_1', axis: 'x' } }, min: x - 0.035, max: x + 0.035 },
      { at: 24, probe: { pose: { part: 'bearing_1', axis: 'z' } }, min: z - 0.035, max: z + 0.035 },
      { at: 24, probe: { pose: { part: 'bearing_1', axis: 'y' } }, min: y + 0.08, max: y + 0.2 },
      { at: 24, tag: 'BatchDone', equals: true },
      { at: 24, tag: 'BatchFault', equals: false },
    ],
  }
  const parts = project.scene.parts.filter((part) => part.id !== 'bearing_2' && part.id !== 'bearing_3').map((part) => {
    if (part.id === fixture.id) return { ...part, name: t(M.target) }
    if (part.id === arm.id && part.type === 'part') return { ...part, params: { ...part.params, jobs, jobNames: t(M.job) } }
    return part
  })
  return { ...project, name: t(M.name), scene: { ...project.scene, parts }, stProgram, tests: [test] }
}
