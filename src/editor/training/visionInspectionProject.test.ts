import initJolt from 'jolt-physics'
import { describe, expect, it } from 'vitest'
import { buildPackage } from '../../sim/buildPackage'
import { bundledPartById } from '../parts/bundledExamples'
import { runProjectTest } from '../project/projectTestRunner'
import { createVisionInspectionProject } from './visionInspectionProject'

describe('vision-guided sorting lesson', () => {
  it('moves the workpiece from a detected position and blocks motion when there is no detection', async () => {
    const Jolt = await initJolt()
    const lesson = createVisionInspectionProject()
    const referenced = new Set(lesson.scene.parts.flatMap((part) => part.type === 'part' ? [part.packageId] : []))
    const packages = [...referenced].map((id) => {
      const data = bundledPartById(id)
      if (!data) throw new Error('Missing bundled part: ' + id)
      return buildPackage(data.manifest, data.behavior)
    })
    const project = { ...lesson, packages }
    for (const test of project.tests ?? []) {
      const result = runProjectTest(Jolt, project, test)
      expect(result.checks.filter((check) => !check.ok), test.name).toEqual([])
    }
  })
})

