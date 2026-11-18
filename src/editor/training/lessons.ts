import { versionedAssetUrl } from '../../core/assetVersions'
import { defineMessages, t } from '../../core/i18n'
import { uniqueName } from '../../core/parts/partDisplayName'
import type { ProjectJSON } from '../../core/project/project'
import { oipBytesToProject } from '../../core/project/projectArchive'
import { folderFilesToProject } from '../../core/project/projectFolder'
import { bakePart } from '../parts/bakePart'
import { listDocuments } from '../project/documentStore'
import { storeLocalAssets } from '../project/localAssets'
import { canCreateProject, createProjectFrom } from '../project/newProject'
import type { EditorStore } from '../store/store'
import { setTrainingLaunch } from './launch'

const M = defineMessages('trainingLessons', {
  bearing: 'Bearing loading workstation',
  bearingBrief: 'Run a tabletop cell as a connected workstation, with a robot, short conveyor, photoeye and operator panel.',
  bearingStep: 'Teach or preview a named pick and drop point. Inspect the robot job and map its command, execution and ready signals in the PLC.',
  bearingCheck: 'Run the cell from the operator panel. Three bearings leave the conveyor. Pause and resume without losing a job, then run the project tests.',
  assembly: 'Bearing assembly placement',
  assemblyBrief: 'Pick one bearing and place it on a separate locating fixture.',
  assemblyStep: 'Inspect the taught approach, placement and retract points. Run the cell from the operator panel.',
  assemblyCheck: 'The part is lifted, released and remains within the locating fixture tolerance. Verify the placement in the project test.',
  pallet: 'Robot palletizing',
  palletBrief: 'Move cases into layers and let the robot stack them onto a pallet.',
  palletStep: 'Select the palletizer and inspect how its job changes between picking a layer and placing each course.',
  palletCheck: 'Run the project test to verify feeding, layer formation, palletizing and the storage transfer.',
  motor: 'Motor start and stop',
  motorBrief: 'Build and diagnose a motor holding circuit with feedback checking.',
  motorStep: 'Find Start, Stop, Run and Running in the PLC. Trace the feedback timer and work through the motor fault case.',
  motorCheck: 'Start holds Run after the pulse. Stop and faults drop it. Reset is required after the fault clears.',
  jam: 'Conveyor jam detection',
  jamBrief: 'Check normal flow and stop the conveyor when the photoeye stays blocked.',
  jamStep: 'Find the photoeye and conveyor, inspect the timer and run the flow and jam tests.',
  jamCheck: 'Normal flow continues. A sustained jam sets JamAlarm, stops the belt and requires a reset.',
  gantry: 'Three-axis gantry handling',
  gantryBrief: 'Make a PLC step sequence move a box between two positions.',
  gantryStep: 'Trace the three motion-block calls and the vacuum output. Compare the moving tool and the process values.',
  gantryCheck: 'The box is picked up, reaches the second station and returns. The path test passes with no fault.',
  monitoring: 'Monitoring and fault response',
  monitoringBrief: 'Compare a normal conveyor run with a simulated jam and keep the records.',
  monitoringStep: 'Start the conveyor. In Run & verify, record BeltRun and JamAlarm. Enable the alarm rule for JamAlarm, then switch InjectJam on and confirm the alarm.',
  monitoringCheck: 'JamAlarm rises and BeltRun drops. Clear InjectJam, pulse Reset and Start, then stop the simulation and find both states in the saved record.',
  vision: 'Camera inspection and classification',
  visionBrief: 'Trigger a virtual camera and use the measured position in the PLC.',
  visionStep: 'Open Machine vision, check the camera and output mapping, and run the example to trigger an inspection from the PLC.',
  visionCheck: 'A valid detection returns a position and completion signal. The PLC uses the measured location to classify the target.',
  stoppedRequired: 'Stop the simulation and open an editable project before creating a training copy.',
  loadFailed: 'Could not create this training task: {error}',
})

export const LESSONS = [
  { id: 'bearing', name: M.bearing, brief: M.bearingBrief, step: M.bearingStep, check: M.bearingCheck },
  { id: 'assembly', name: M.assembly, brief: M.assemblyBrief, step: M.assemblyStep, check: M.assemblyCheck },
  { id: 'palletizing', name: M.pallet, brief: M.palletBrief, step: M.palletStep, check: M.palletCheck },
  { id: 'start-stop-motor', name: M.motor, brief: M.motorBrief, step: M.motorStep, check: M.motorCheck },
  { id: 'jam-detect', name: M.jam, brief: M.jamBrief, step: M.jamStep, check: M.jamCheck },
  { id: 'gantry-motion', name: M.gantry, brief: M.gantryBrief, step: M.gantryStep, check: M.gantryCheck },
  { id: 'monitoring', name: M.monitoring, brief: M.monitoringBrief, step: M.monitoringStep, check: M.monitoringCheck },
  { id: 'vision', name: M.vision, brief: M.visionBrief, step: M.visionStep, check: M.visionCheck },
] as const

export type Lesson = (typeof LESSONS)[number]

const exampleFiles = import.meta.glob<string>(
  '../../../examples/projects/{start-stop-motor,jam-detect,gantry-motion}/**/*.{json,st,js}',
  { query: '?raw', import: 'default' },
)

async function loadBearing(): Promise<ProjectJSON> {
  const response = await fetch(versionedAssetUrl('/training/bearing-workstation-v2.oip'))
  if (!response.ok) throw new Error(String(response.status))
  const result = await oipBytesToProject(new Uint8Array(await response.arrayBuffer()), { bakePart })
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.project
}

export async function loadTrainingLesson(id: Lesson['id']): Promise<ProjectJSON> {
  if (id === 'bearing') return loadBearing()
  if (id === 'assembly') {
    const { assembleBearingLesson } = await import('./bearingAssembly')
    return assembleBearingLesson(await loadBearing())
  }
  if (id === 'palletizing') {
    const [{ createPlcDemoScene }, { demoProject, ladderSpec }] = await Promise.all([import('../demo/demoScenes'), import('../demo/demoAcceptance')])
    const scene = createPlcDemoScene()
    return { ...demoProject(scene), tests: [ladderSpec(scene)] }
  }
  if (id === 'vision') return (await import('./visionInspectionProject')).createVisionInspectionProject()
  const prefix = '../../../examples/projects/' + (id === 'monitoring' ? 'jam-detect' : id) + '/'
  const files = await Promise.all(Object.entries(exampleFiles).filter(([path]) => path.startsWith(prefix)).map(async ([path, read]) => ({
    path: path.slice(prefix.length), contents: await read(),
  })))
  const result = folderFilesToProject(files, { bakePart })
  if (!result.ok) throw new Error(result.errors.join('\n'))
  if (id !== 'monitoring') return result.project
  const program = result.project.stProgram
  const monitoredProgram = program?.replace('  Eye : BOOL;', '  Eye : BOOL;\n  InjectJam : BOOL;')
    .replace('Blocked(IN := Eye AND BeltRun,', 'Blocked(IN := (Eye OR InjectJam) AND BeltRun,')
  if (!monitoredProgram?.includes('OR InjectJam')) throw new Error('Jam detection PLC template changed')
  return { ...result.project, stProgram: monitoredProgram }
}

export async function openTrainingLesson(store: EditorStore, lesson: Lesson): Promise<string | null> {
  if (store.getState().running || !canCreateProject(store)) return t(M.stoppedRequired)
  try {
    const project = await loadTrainingLesson(lesson.id)
    const documents = await listDocuments()
    const name = uniqueName(new Set(documents.map((doc) => doc.name)), t(lesson.name))
    await storeLocalAssets(project)
    setTrainingLaunch(lesson.id)
    const error = await createProjectFrom(store, { ...project, name })
    if (error) {
      setTrainingLaunch(null)
      return t(M.loadFailed, { error })
    }
    return null
  } catch (error) {
    setTrainingLaunch(null)
    return t(M.loadFailed, { error: error instanceof Error ? error.message : String(error) })
  }
}
