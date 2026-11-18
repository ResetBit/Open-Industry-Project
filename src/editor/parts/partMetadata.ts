import { activeLocale, t } from '../../core/i18n'
import { labelHead } from '../../core/packageParams'
import { partTypeName } from '../../core/parts/partDisplayName'
import { builtInPackage } from '../../core/parts/partRegistry'
import type { PartPackage } from '../../core/parts/partPackage'
import type { ParamSpec, PartInstance } from '../../core/types'

/** These keys refer to shipped metadata values, which also live in portable part files. */
export function translatePartMetadata(source: string): string {
  if (activeLocale() !== 'zh-CN') return source
  const key = `partMetadata:${source}`
  const translated = t(key)
  return translated === key ? source : translated
}

export function localizePackageName(pkg: PartPackage): string {
  return builtInPackage(pkg.id) ? translatePartMetadata(pkg.name) : pkg.name
}

/** Saved copies share their built-in ID. Only metadata with an exact dictionary match is translated. */
export function hasBundledMetadata(part: PartInstance): boolean {
  return part.type !== 'part' || builtInPackage(part.packageId) !== undefined
}

export function localizePartDisplayName(part: PartInstance, display: string): string {
  if (part.name?.trim() || !hasBundledMetadata(part)) return display
  const base = partTypeName(part)
  return translatePartMetadata(base) + display.slice(base.length)
}

export function localizedParamLabel(source: string, localize: boolean, compact = false): string {
  const shown = compact ? labelHead(source) : source
  if (!localize) return shown
  const translated = translatePartMetadata(source)
  if (translated === source) return shown
  return compact && shown !== source && !shown.endsWith(')')
    ? translated.replace(/\s*（[^（）]*）$/, '')
    : translated
}

/** Copy presentation fields only. The package and the fields used by the simulation stay in their authored form. */
export function localizedParamSpec(spec: ParamSpec, localize: boolean): ParamSpec {
  if (!localize || activeLocale() !== 'zh-CN') return spec
  switch (spec.kind) {
    case 'enum':
      return { ...spec, options: spec.options.map((option) => ({ ...option, label: translatePartMetadata(option.label) })) }
    case 'tagRef':
      return spec.values
        ? { ...spec, values: spec.values.map((value) => ({ ...value, label: translatePartMetadata(value.label) })) }
        : spec
    case 'numberList':
      return {
        ...spec,
        ...(spec.cellLabels ? { cellLabels: spec.cellLabels.map(translatePartMetadata) } : {}),
        ...(spec.program ? {
          program: {
            ...spec.program,
            ops: spec.program.ops.map((op) => ({
              ...op,
              label: translatePartMetadata(op.label),
              ...(op.desc ? { desc: translatePartMetadata(op.desc) } : {}),
              ...(op.args ? {
                args: op.args.map((arg) => {
                  const label = arg.label ? { label: translatePartMetadata(arg.label) } : {}
                  return arg.kind === 'choice'
                    ? { ...arg, ...label, options: arg.options.map((option) => ({ ...option, label: translatePartMetadata(option.label) })) }
                    : { ...arg, ...label }
                }),
              } : {}),
            })),
          },
        } : {}),
      }
    default:
      return spec
  }
}
