import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../core/i18n'
import { packageParamSpecs } from '../../core/packageParams'
import { registerPackage, setBuiltInPackages, unregisterPackage } from '../../core/parts/partRegistry'
import type { EnumParamSpec, SdkPart } from '../../core/types'
import { createPart } from '../../core/scene/scene'
import { buildPackage } from '../../sim/buildPackage'
import { simplifiedChinese } from '../locales/zh-CN'
import { bundledPartById } from './bundledExamples'
import { hasBundledMetadata, localizePackageName, localizedParamLabel, localizedParamSpec, localizePartDisplayName, translatePartMetadata } from './partMetadata'

afterEach(() => setLocale('en', null))

describe('bundled part metadata localization', () => {
  it('localizes compact labels and options while keeping their stored keys and values', () => {
    const spec: EnumParamSpec = {
      kind: 'enum',
      key: 'tool',
      label: 'Tool (mounted on flange)',
      default: 'vacuum',
      options: [{ value: 'vacuum', label: 'Vacuum plate' }],
    }
    setLocale('zh-CN', new Map([
      ['partMetadata:Tool (mounted on flange)', '工具（安装于法兰）'],
      ['partMetadata:Vacuum plate', '真空吸盘板'],
    ]))
    expect(localizedParamLabel(spec.label, true, true)).toBe('工具')
    expect(localizedParamLabel(spec.label, true)).toBe('工具（安装于法兰）')
    expect(localizedParamSpec(spec, true)).toEqual({
      ...spec,
      options: [{ value: 'vacuum', label: '真空吸盘板' }],
    })
    expect(localizedParamSpec(spec, false)).toBe(spec)
    expect(spec.options[0]?.label).toBe('Vacuum plate')

    setLocale('en', null)
    expect(localizedParamLabel(spec.label, true, true)).toBe('Tool')
    expect(localizedParamSpec(spec, true)).toBe(spec)
  })

  it('translates the built-in robot in a saved project copy without changing its labels or values', () => {
    const data = bundledPartById('oip.six-axis-robot')!
    const shipped = buildPackage(data.manifest, data.behavior)
    const saved = { ...shipped, behavior: shipped.behavior + '\n// Saved project revision' }
    const robot: SdkPart = { id: 'robot', type: 'part', packageId: saved.id, position: [0, 0, 0], rotationY: 0, params: {} }
    const specs = packageParamSpecs(saved)
    const speed = specs.find((s) => s.key === 'speed')!
    const tool = specs.find((s) => s.key === 'tool') as EnumParamSpec
    setBuiltInPackages([shipped])
    registerPackage(saved, true)
    try {
      setLocale('zh-CN', new Map(Object.entries(simplifiedChinese)))
      const localize = hasBundledMetadata(robot)
      expect(localize).toBe(true)
      expect(localizePackageName(saved)).toBe('六轴机器人')
      expect(localizedParamLabel(speed.label, localize, true)).toBe('关节速度')
      expect(localizedParamLabel('Custom robot property', localize)).toBe('Custom robot property')
      expect(translatePartMetadata(speed.desc!)).not.toBe(speed.desc)
      const translatedTool = localizedParamSpec(tool, localize) as EnumParamSpec
      expect(translatedTool.options[0]).toEqual({ value: 'vacuum', label: '真空吸盘板' })
      expect(tool.options[0]).toEqual({ value: 'vacuum', label: 'Vacuum plate' })
      expect(hasBundledMetadata({ ...robot, packageId: 'custom.robot' })).toBe(false)

      setLocale('en', null)
      expect(localizePackageName(saved)).toBe('Six-Axis Robot')
      expect(localizedParamLabel(speed.label, localize, true)).toBe('Joint speed')
      expect(localizedParamSpec(tool, localize)).toBe(tool)
    } finally {
      unregisterPackage(saved.id)
      setBuiltInPackages([])
    }
  })

  it('localizes only the type-derived name and leaves an explicit user name intact', () => {
    const part = createPart('group', 'group-1', [0, 0, 0])
    setLocale('zh-CN', new Map([['partMetadata:Group', '组']]))
    expect(localizePartDisplayName(part, 'Group 2')).toBe('组 2')
    expect(localizePartDisplayName({ ...part, name: 'Group 2' }, 'Group 2')).toBe('Group 2')
  })
})

