import type Jolt from 'jolt-physics'
import type { JoltModule, PartGroup } from './worldTypes'

export type PartInterference =
  | { kind: 'unavailable' }
  | { kind: 'clear' }
  | { kind: 'overlap'; point: [number, number, number]; penetrationMetres: number }

/** Sample two equipment groups in the current Jolt world, including movable rig links. */
export function inspectPartInterference(
  J: JoltModule,
  system: Jolt.PhysicsSystem,
  first: PartGroup | undefined,
  second: PartGroup | undefined,
): PartInterference {
  if (!first?.bodies.length || !second?.bodies.length || first === second) return { kind: 'unavailable' }
  const target = new Set(second.bodies.map((body) => body.GetID().GetIndexAndSequenceNumber()))
  const settings = new J.CollideShapeSettings()
  const scale = new J.Vec3(1, 1, 1)
  const offset = new J.RVec3(0, 0, 0)
  const broadPhase = new J.BroadPhaseLayerFilter()
  const objectLayer = new J.ObjectLayerFilter()
  const shapeFilter = new J.ShapeFilter()
  const bodyFilter = new J.BodyFilter()
  const query = system.GetNarrowPhaseQuery()
  let result: PartInterference = { kind: 'clear' }
  try {
    for (const body of first.bodies) {
      const collector = new J.CollideShapeAllHitCollisionCollector()
      try {
        query.CollideShape(body.GetShape(), scale, body.GetCenterOfMassTransform(), settings, offset,
          collector, broadPhase, objectLayer, bodyFilter, shapeFilter)
        const hits = collector.mHits
        for (let i = 0; i < hits.size(); i++) {
          const hit = hits.at(i)
          if (!target.has(hit.mBodyID2.GetIndexAndSequenceNumber()) || hit.mPenetrationDepth <= 0.0001) continue
          if (result.kind === 'overlap' && result.penetrationMetres >= hit.mPenetrationDepth) continue
          const point = hit.mContactPointOn2
          result = {
            kind: 'overlap',
            point: [point.GetX(), point.GetY(), point.GetZ()],
            penetrationMetres: hit.mPenetrationDepth,
          }
        }
      } finally {
        J.destroy(collector)
      }
    }
    return result
  } finally {
    for (const value of [settings, scale, offset, broadPhase, objectLayer, bodyFilter, shapeFilter]) J.destroy(value)
  }
}
