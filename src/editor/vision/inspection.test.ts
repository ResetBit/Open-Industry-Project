import { describe, expect, it } from 'vitest'
import { detectColor } from './detectColor'
import { visionHandshake, visionWrites, type VisionInspection } from './inspection'
import type { VisionProfile } from './profile'

const profile: VisionProfile = {
  camera: { position: [0, 1, 0], target: [0, 0, 0], fov: 50, width: 320, height: 240, lightIntensity: 0 },
  color: '#ff0000', tolerance: 0, minArea: 2, planeY: 0.3, plcMode: 'plane', automatic: true,
  mapping: { request: 'Request', found: 'Found', centerX: 'X', centerY: 'Z', done: 'Done', fault: 'Fault' },
}

const result: VisionInspection = {
  frame: { width: 1, height: 1, rgba: new Uint8ClampedArray(4), projectToPlane: () => ({ x: -0.65, z: 0.32 }) },
  target: { x: 0, y: 0, width: 1, height: 1, centerX: 0, centerY: 0, area: 1 },
  planePoint: { x: -0.65, z: 0.32 },
}

describe('virtual camera inspection', () => {
  it('uses the largest connected target, excluding a separate matching pixel', () => {
    const pixels = new Uint8ClampedArray(5 * 3 * 4)
    for (const i of [0, 1, 5, 14]) { pixels[i * 4] = 255; pixels[i * 4 + 3] = 255 }
    expect(detectColor(pixels, 5, 3, [255, 0, 0], 0, 2)).toEqual({
      x: 0, y: 0, width: 2, height: 2, centerX: 1 / 3, centerY: 1 / 3, area: 3,
    })
  })

  it('clears stale coordinates on no target and reports camera faults separately', () => {
    expect(visionWrites(profile, null, true)).toEqual([['Found', false], ['X', 0], ['Z', 0], ['Done', true], ['Fault', false]])
    expect(visionWrites(profile, null, true, true).at(-1)).toEqual(['Fault', true])
  })

  it('acquires once until the PLC drops the request, even when several polls overlap', async () => {
    let request = true
    let captures = 0
    const epoch = {}
    const writes: Array<Record<string, unknown>> = []
    const machine = visionHandshake({
      epoch: () => epoch, isPaused: () => false, read: () => request,
      write: (values) => { writes.push(Object.fromEntries(values)); return null },
    }, profile, async () => { captures++; return result }, () => {})
    await Promise.all([machine.poll(), machine.poll()])
    await machine.poll()
    expect(captures).toBe(1)
    expect(writes[0]).toEqual({ Found: true, X: -0.65, Z: 0.32, Done: true, Fault: false })
    request = false
    await machine.poll()
    expect(writes[1]).toEqual({ Done: false, Fault: false })
    request = true
    await machine.poll()
    expect(captures).toBe(2)
  })

  it('drops a pending capture when the active PLC changes', async () => {
    let epoch: object = {}
    let resolveCapture: (value: VisionInspection) => void = () => {}
    let writes = 0
    const machine = visionHandshake({
      epoch: () => epoch, isPaused: () => false, read: () => true,
      write: () => { writes++; return null },
    }, profile, () => new Promise((resolve) => { resolveCapture = resolve }), () => {})
    const pending = machine.poll()
    epoch = {}
    resolveCapture(result)
    await pending
    expect(writes).toBe(0)
  })
})
