import { describe, expect, it } from 'vitest'
import type { SdkPart } from '../../../core/types'
import type { RigGeometry, RigJoint } from '../../../core/parts/partPackage'
import type { TeachModel } from './teachModel'
import { captureWaypoint, jogCartesian, jogJoint, readTcp, tcpPose, teachingDocument, validateTeaching } from './teachModel'

const joints: RigJoint[] = [
  { name: 'SlideX', link: 'X', min: 0, max: 1, axis: [1, 0, 0], type: 'prismatic' },
  { name: 'SlideY', link: 'Y', min: 0, max: 1, axis: [0, 1, 0], type: 'prismatic' },
]
const geometry: RigGeometry = {
  kind: 'rig',
  links: [
    { name: 'X', parent: undefined, offset: [0, 0, 0], shape: { kind: 'frame' } },
    { name: 'Y', parent: 'X', offset: [0, 0, 0], shape: { kind: 'frame' } },
  ],
  joints,
}
const part: SdkPart = {
  id: 'fixture-robot',
  type: 'part',
  packageId: 'test.slide-robot',
  position: [2, 0, 3],
  rotationY: Math.PI / 2,
  params: {},
}
const model: TeachModel = {
  kin: { geometry, joints, end: 'Y', approach: null },
  params: { speed: 100, accel: 200 },
  scale: 1,
  waypoints: [[0, 0], [20, 10]],
  waypointNames: ['Home', 'Pick'],
  jobs: [[0, 1, 1, 0]],
  jobNames: ['Pick part'],
}

describe('robot teaching workflow', () => {
  it('jogs bounded native units and resolves Cartesian movements in the selected frame', () => {
    expect(jogJoint(model, [995, 10], 0, 25)).toEqual([1000, 10])
    const world = readTcp(part, tcpPose(model, [20, 10])!, 'world', undefined)
    expect(world.pos[0]).toBeCloseTo(2)
    expect(world.pos[2]).toBeCloseTo(2.98)
    const base = jogCartesian(part, model, [20, 10], 'base', 0, 0.01, undefined)
    expect(base?.[0]).toBeCloseTo(30, 0)
    const workpiece = { ...part, id: 'fixture', rotationY: 0 }
    const relative = jogCartesian(part, model, [20, 10], 'workpiece', 2, -0.01, workpiece)
    expect(relative?.[0]).toBeCloseTo(30, 0)
    expect(jogCartesian(part, model, [20, 10], 'base', 2, 0.01, undefined)).toBeNull()
  })

  it('preserves point indices and emits a portable document with checked jobs', () => {
    const edited = captureWaypoint(model, [40, 12], 'Pick refined', 1)
    expect(edited.waypointNames).toBe('Home\nPick refined')
    expect(edited.waypoints).toEqual([[0, 0], [40, 12]])
    expect(model.waypoints[1]).toEqual([20, 10])
    expect(validateTeaching(model)).toEqual([])
    expect(validateTeaching({ ...model, jobs: [[0, 1, 2, 0]] })).toEqual([{ kind: 'jobPoint', step: 1 }])
    expect(teachingDocument(part, model)).toMatchObject({
      format: 'oip-robot-teaching',
      joints: [{ name: 'SlideX', unit: 'mm' }, { name: 'SlideY', unit: 'mm' }],
      waypoints: [{ name: 'Home', index: 0 }, { name: 'Pick', index: 1 }],
    })
  })
})

