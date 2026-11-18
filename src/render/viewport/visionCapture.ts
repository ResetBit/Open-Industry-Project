import { PerspectiveCamera, PointLight, SRGBColorSpace, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import type { Scene } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { VisionCameraSettings, VisionFrame } from '../api'
import { defineMessages, t } from '../../core/i18n'

const M = defineMessages('visionCapture', {
  invalidSize: 'Camera resolution must be between 64 and 1024 pixels.',
  invalidPose: 'Set a valid camera position, aim point, field of view, and light intensity.',
  incomplete: 'The camera returned an incomplete image.',
})

/** Capture the live scene from a separate camera without changing the editor's camera or output target. */
export async function captureVisionFrame(
  renderer: WebGLRenderer | WebGPURenderer,
  scene: Scene,
  settings: VisionCameraSettings,
): Promise<VisionFrame> {
  const { width, height, position, target, fov, lightIntensity } = settings
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 1024 || height > 1024) {
    throw new Error(t(M.invalidSize))
  }
  if (![...position, ...target, fov, lightIntensity].every(Number.isFinite) ||
      fov < 10 || fov > 120 || lightIntensity < 0 || lightIntensity > 100 ||
      Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) < 0.001) {
    throw new Error(t(M.invalidPose))
  }

  const camera = new PerspectiveCamera(fov, width / height, 0.01, 500)
  camera.position.fromArray(position)
  if (Math.hypot(position[0] - target[0], position[2] - target[2]) < 0.001) camera.up.set(0, 0, -1)
  camera.lookAt(...target)

  const light = lightIntensity > 0 ? new PointLight(0xffffff, lightIntensity) : null
  if (light) {
    light.position.copy(camera.position)
    scene.add(light)
  }
  const isWebGL = renderer instanceof WebGLRenderer
  const buffer = new WebGLRenderTarget(width, height)
  buffer.texture.colorSpace = SRGBColorSpace
  const autoClear = renderer.autoClear
  try {
    let read: Promise<ArrayLike<number>>
    try {
      renderer.autoClear = true
      read = renderAndRead(renderer, scene, camera, buffer)
    } finally {
      if (light) scene.remove(light)
      renderer.autoClear = autoClear
    }

    const bytes = await read
    if (bytes.length !== width * height * 4) throw new Error(t(M.incomplete))
    const rgba = new Uint8ClampedArray(bytes)
    if (isWebGL || 'isWebGLBackend' in renderer.backend && renderer.backend.isWebGLBackend) flipRows(rgba, width * 4, height)
    return {
      width, height, rgba,
      projectToPlane: (x, y, planeY) => projectToPlane(camera, width, height, x, y, planeY),
    }
  } finally {
    buffer.dispose()
  }
}

function renderAndRead(
  renderer: WebGLRenderer | WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  buffer: WebGLRenderTarget,
): Promise<ArrayLike<number>> {
  const face = renderer.getActiveCubeFace()
  const mip = renderer.getActiveMipmapLevel()
  if (renderer instanceof WebGLRenderer) {
    const previousTarget = renderer.getRenderTarget()
    try {
      renderer.setRenderTarget(buffer)
      renderer.render(scene, camera)
      return renderer.readRenderTargetPixelsAsync(buffer, 0, 0, buffer.width, buffer.height,
        new Uint8Array(buffer.width * buffer.height * 4))
    } finally {
      renderer.setRenderTarget(previousTarget, face, mip)
    }
  }

  const previousTarget = renderer.getRenderTarget()
  try {
    renderer.setRenderTarget(buffer)
    renderer.render(scene, camera)
    return renderer.readRenderTargetPixelsAsync(buffer, 0, 0, buffer.width, buffer.height)
  } finally {
    renderer.setRenderTarget(previousTarget, face, mip)
  }
}

function flipRows(rgba: Uint8ClampedArray, stride: number, height: number): void {
  const row = new Uint8ClampedArray(stride)
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    row.set(rgba.subarray(top * stride, (top + 1) * stride))
    rgba.copyWithin(top * stride, bottom * stride, (bottom + 1) * stride)
    rgba.set(row, bottom * stride)
  }
}


function projectToPlane(
  camera: PerspectiveCamera,
  width: number,
  height: number,
  x: number,
  y: number,
  planeY: number,
): { x: number; z: number } | null {
  if (![x, y, planeY].every(Number.isFinite) || x < 0 || y < 0 || x >= width || y >= height) return null

  // Integer image coordinates refer to pixel centres. Canvas Y increases downwards.
  const ray = new Vector3(2 * (x + 0.5) / width - 1, 1 - 2 * (y + 0.5) / height, 0.5)
    .unproject(camera).sub(camera.position).normalize()
  if (Math.abs(ray.y) < 1e-7) return null

  const distance = (planeY - camera.position.y) / ray.y
  const depth = distance * ray.dot(camera.getWorldDirection(new Vector3()))
  if (!Number.isFinite(depth) || depth < camera.near || depth > camera.far) return null

  const world = ray.multiplyScalar(distance).add(camera.position)
  return Number.isFinite(world.x) && Number.isFinite(world.z) ? { x: world.x, z: world.z } : null
}
