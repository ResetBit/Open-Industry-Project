import { clamp, quatFromYXZ } from '../../../core/math'
import type { PartPackage } from '../../../core/parts/partPackage'
import { resolvePartParams } from '../../../core/parts/partScript'
import { jointLimits, qApply, qConjugate, qMul, rigWorldPoses, type LinkPose, type RigParams, type Vec3 } from '../../../core/rig/rigPose'
import { ROBOT_IO_COUNT, ROBOT_OP, robotUnit } from '../../../core/robot/robotController'
import { robotKinematics, robotKinematicsOf, solveRobotIk, type RobotKinematics } from '../../../core/robot/robotIk'
import type { PartInstance, SdkPart } from '../../../core/types'
import { joinNames, splitNames } from './programLogic'

const AXES: readonly Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
export type TeachFrame = 'base' | 'world' | 'tool' | 'workpiece'

export interface TeachModel {
  kin: RobotKinematics
  params: RigParams
  scale: number
  waypoints: number[][]
  waypointNames: string[]
  jobs: number[][]
  jobNames: string[]
}

export function teachModel(part: SdkPart, pkg: PartPackage | undefined): TeachModel | null {
  if (pkg?.geometry.kind !== 'rig' || pkg.params?.waypoints?.type !== 'numberList' || pkg.params.jobs?.type !== 'numberList' || !pkg.params.jobs.program) return null
  const params = resolvePartParams(pkg.params, part.params)
  const geometry = pkg.geometry
  // Saved six-axis parts from before the SDK's robot declaration already use this exact teaching rig.
  const classicSixAxis = geometry.joints.length === 6
    && geometry.joints.every((joint, index) => joint.type === 'revolute' && joint.name === 'j' + (index + 1))
    && geometry.links.some((link) => link.name === 'gripper')
    && geometry.links.some((link) => link.name === 'eoat')
  const kin = robotKinematics(geometry, pkg.behavior, params) ?? (classicSixAxis
    ? robotKinematicsOf(geometry, { gripper: 'gripper', tool: 'eoat' }, params)
    : null)
  if (!kin) return null
  return {
    kin,
    params: params as RigParams,
    scale: typeof params.scale === 'number' && params.scale > 0 ? params.scale : 1,
    waypoints: Array.isArray(params.waypoints) ? params.waypoints : [],
    waypointNames: splitNames(params.waypointNames),
    jobs: Array.isArray(params.jobs) ? params.jobs : [],
    jobNames: splitNames(params.jobNames),
  }
}

const rotation = (part: PartInstance) => quatFromYXZ(part.rotationX ?? 0, part.rotationY, part.rotationZ ?? 0)
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const nativePose = (model: TeachModel, row: readonly number[]) =>
  Object.fromEntries(model.kin.joints.map((joint, i) => [joint.name, (row[i] ?? 0) / robotUnit(joint.type)]))

export function tcpPose(model: TeachModel, row: readonly number[]): LinkPose | undefined {
  return rigWorldPoses(model.kin.geometry, nativePose(model, row), undefined, model.scale, model.params).get(model.kin.end)
}

/** Translate a point and orientation from the robot base to the selected fixed coordinate frame. */
export function readTcp(part: PartInstance, pose: LinkPose, frame: TeachFrame, workpiece: PartInstance | undefined): LinkPose {
  if (frame === 'base' || frame === 'tool') return pose
  const base = rotation(part)
  const pos = add(part.position, qApply(base, pose.pos))
  const quat = qMul(base, pose.quat)
  if (frame === 'world' || !workpiece) return { pos, quat }
  const inv = qConjugate(rotation(workpiece))
  return { pos: qApply(inv, subtract(pos, workpiece.position)), quat: qMul(inv, quat) }
}

export function jogJoint(model: TeachModel, row: readonly number[], index: number, amount: number): number[] {
  const joint = model.kin.joints[index]
  if (!joint) return [...row]
  const units = robotUnit(joint.type)
  const [min, max] = jointLimits(joint, model.params)
  return row.map((value, i) => i === index ? clamp(value + amount, min * units, max * units) : value)
}

export function jogCartesian(
  part: PartInstance, model: TeachModel, row: readonly number[], frame: TeachFrame,
  axis: number, distance: number, workpiece: PartInstance | undefined,
): number[] | null {
  const pose = tcpPose(model, row)
  const axes = AXES[axis]
  if (!pose || !axes || (frame === 'workpiece' && !workpiece)) return null
  const inverseBase = qConjugate(rotation(part))
  const direction = frame === 'tool'
    ? qApply(pose.quat, axes)
    : frame === 'base' ? axes : qApply(inverseBase, workpiece && frame === 'workpiece' ? qApply(rotation(workpiece), axes) : axes)
  const target = add(pose.pos, [direction[0] * distance, direction[1] * distance, direction[2] * distance])
  const seed = nativePose(model, row)
  const solved = solveRobotIk({
    geometry: model.kin.geometry,
    params: model.params,
    scale: model.scale,
    end: model.kin.end,
    joints: model.kin.joints.map((joint) => joint.name),
    target,
    approach: { link: model.kin.end, axis: [0, 1, 0], toward: qApply(pose.quat, [0, 1, 0]) },
    face: { link: model.kin.end, axis: [1, 0, 0], toward: qApply(pose.quat, [1, 0, 0]) },
    seed,
  })
  if (!(solved.miss < 0.001 && solved.turn < 0.02)) return null
  return model.kin.joints.map((joint) => (solved.values[joint.name] ?? seed[joint.name] ?? 0) * robotUnit(joint.type))
}

export type TeachIssue =
  | { kind: 'pointData'; point: number }
  | { kind: 'pointLimit'; point: number; joint: string }
  | { kind: 'jobData' | 'jobPoint'; step: number }
  | { kind: 'motion' }

export function validateTeaching(model: TeachModel): TeachIssue[] {
  const issues: TeachIssue[] = []
  const joints = model.kin.joints
  model.waypoints.forEach((row, i) => {
    const point = i + 1
    if (row.length !== joints.length || !row.every(Number.isFinite)) {
      issues.push({ kind: 'pointData', point })
      return
    }
    joints.forEach((joint, j) => {
      const [min, max] = jointLimits(joint, model.params)
      const v = row[j]!
      const unit = robotUnit(joint.type)
      if (v < min * unit - 0.0051 || v > max * unit + 0.0051) issues.push({ kind: 'pointLimit', point, joint: joint.name })
    })
  })
  const flag = (value: number | undefined) => value === 0 || value === 1
  const channel = (index: number | undefined) => index !== undefined && Number.isInteger(index) && index >= 0 && index < ROBOT_IO_COUNT
  model.jobs.forEach(([job, op, a, b], i) => {
    const step = i + 1
    if (job === undefined || !Number.isInteger(job) || job < 0 || job > 9999) {
      issues.push({ kind: 'jobData', step })
      return
    }
    if (op === ROBOT_OP.move && (a === undefined || !Number.isInteger(a) || !model.waypoints[a])) {
      issues.push({ kind: 'jobPoint', step })
      return
    }
    const valid = op === ROBOT_OP.move ? flag(b)
      : op === ROBOT_OP.grip ? flag(a)
      : op === ROBOT_OP.wait ? a !== undefined && Number.isFinite(a) && a >= 0
      : (op === ROBOT_OP.waitFor || op === ROBOT_OP.setOutput) && channel(a) && flag(b)
    if (!valid) issues.push({ kind: 'jobData', step })
  })
  if ([model.params.speed, model.params.accel].some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) issues.push({ kind: 'motion' })
  return issues
}

export function captureWaypoint(model: TeachModel, row: readonly number[], name: string, index: number | null): { waypoints: number[][]; waypointNames: string } {
  const waypoints = model.waypoints.map((point) => [...point])
  const target = index !== null && waypoints[index] ? index : waypoints.length
  waypoints[target] = [...row]
  const names = Array.from({ length: waypoints.length }, (_, i) => i === target ? name.trim().replace(/[\r\n]/g, ' ') : model.waypointNames[i] ?? '')
  return { waypoints, waypointNames: joinNames(names) }
}

/** Portable interchange for simulation. The robot controller's own program format lives outside the simulator. */
export function teachingDocument(part: SdkPart, model: TeachModel) {
  return {
    format: 'oip-robot-teaching',
    version: 1,
    robot: { partId: part.id, packageId: part.packageId, name: part.name ?? '', scale: model.scale },
    base: { positionMetres: part.position, orientationQuaternion: rotation(part) },
    joints: model.kin.joints.map((j) => ({ name: j.name, kind: j.type, unit: j.type === 'revolute' ? 'deg' : 'mm' })),
    waypoints: model.waypoints.map((row, index) => ({ index, name: model.waypointNames[index] ?? '', joints: row, tcpInBase: tcpPose(model, row) })),
    jobs: model.jobs,
    jobNames: model.jobNames,
    opcodes: ROBOT_OP,
    motion: { speed: model.params.speed, accel: model.params.accel, blendDeg: model.params.blendDeg },
    tags: Object.fromEntries(Object.entries(model.params).filter(([key, value]) => key.endsWith('Tag') && typeof value === 'string' && value)),
  }
}
