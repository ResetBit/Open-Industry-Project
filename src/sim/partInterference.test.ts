import initJolt from 'jolt-physics'
import { expect, it } from 'vitest'
import { checkSelectedClearance } from '../core/geometry/selectedClearance'
import { validateScene } from '../core/scene/scene'
import { SCENE_VERSION, type PartInstance } from '../core/types'
import { buildPackage } from './buildPackage'
import { SimWorld } from './world'

it('separates collision bounds from actual equipment-body interference', async () => {
  const jolt = await initJolt()
  const pkg = buildPackage({
    id: 'test.interference',
    name: 'Equipment',
    geometry: { kind: 'rig', links: [{ name: 'body', shape: { kind: 'box', size: [1, 1, 1] }, offset: [0, 0.5, 0] }], joints: [], bounds: { length: 1, width: 1, top: 1 } },
  }, 'definePart({ step() {} })')
  const at = (id: string, x: number): PartInstance => ({ id, type: 'part', packageId: pkg.id, position: [x, 1, 0], rotationY: 0, params: {} })
  const a = at('a', 0)
  const b = at('b', 0.5)
  const c = at('c', 2)
  const loaded = validateScene({ version: SCENE_VERSION, packages: [pkg], parts: [a, b, c] })
  if (!loaded.ok) throw new Error(loaded.errors.join(', '))
  const world = new SimWorld(jolt, loaded.scene)
  try {
    expect(checkSelectedClearance(a, b).kind).toBe('overlap')
    const gap = checkSelectedClearance(a, c)
    expect(gap.kind).toBe('clearance')
    if (gap.kind === 'clearance') expect(gap.metres).toBeCloseTo(1, 5)
    const overlap = world.partInterference('a', 'b').result
    expect(overlap.kind).toBe('overlap')
    if (overlap.kind === 'overlap') {
      expect(overlap.penetrationMetres).toBeCloseTo(0.5, 3)
      expect(overlap.point.every(Number.isFinite)).toBe(true)
    }
    expect(world.partInterference('a', 'c').result.kind).toBe('clear')
    expect(world.partInterference('a', 'missing').result.kind).toBe('unavailable')
    expect(world.partInterference('a', 'a').result.kind).toBe('unavailable')
  } finally {
    world.dispose()
  }
})

