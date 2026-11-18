import type { PartInstance } from '../types'
import { qApply, qFromEulerXYZ } from '../rig/rigPose'
import { collisionVerticesLocal } from './collisionGeometry'

type Point = [number, number, number]

function bounds(part: PartInstance): { min: Point; max: Point } | null {
  if (part.type === 'group' || part.type === 'annotation' || part.type === 'building') return null
  const points = collisionVerticesLocal(part)
  if (!points.length) return null
  const rotation = qFromEulerXYZ([part.rotationX ?? 0, part.rotationY, part.rotationZ ?? 0])
  const min: Point = [Infinity, Infinity, Infinity]
  const max: Point = [-Infinity, -Infinity, -Infinity]
  for (const point of points) {
    const world = qApply(rotation, [point.x, point.y, point.z])
    for (const axis of [0, 1, 2] as const) {
      const value = world[axis] + part.position[axis]
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  }
  return min.every((value, axis) => max[axis]! - value > 0) ? { min, max } : null
}

export type Clearance =
  | { kind: 'overlap'; point: Point }
  | { kind: 'clearance'; metres: number }
  | { kind: 'unavailable' }

/** A static screening test on collision-proxy AABBs. It does not resolve moving links or intentional contact. */
export function checkSelectedClearance(first: PartInstance, second: PartInstance): Clearance {
  const a = bounds(first)
  const b = bounds(second)
  if (!a || !b) return { kind: 'unavailable' }
  const low: Point = [0, 0, 0]
  const high: Point = [0, 0, 0]
  for (const axis of [0, 1, 2] as const) {
    low[axis] = Math.max(a.min[axis], b.min[axis])
    high[axis] = Math.min(a.max[axis], b.max[axis])
  }
  if (low.every((value, axis) => high[axis]! - value > 0.000001)) {
    return { kind: 'overlap', point: [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2] }
  }
  return { kind: 'clearance', metres: Math.hypot(...low.map((value, axis) => Math.max(0, value - high[axis]!))) }
}
