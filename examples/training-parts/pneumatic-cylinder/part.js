// Double-acting cylinder with independent extend/retract commands and two end sensors.

let progress = null
let target = false
let lastManual

definePart({
  manifest: {
    id: 'training.pneumatic-cylinder',
    name: '双作用气缸 / Double-acting pneumatic cylinder',
    category: 'Equipment',
  },
  interactive: true,
  useParam: 'manual',
  joints: ['stroke'],
  params: {
    stroke: { type: 'number', default: 0.12, min: 0.02, max: 0.35, step: 0.01, unit: 'm', label: '行程 / Stroke' },
    travelTime: { type: 'number', default: 0.4, min: 0.1, max: 3, step: 0.05, unit: 's', label: '单程时间 / Travel time' },
    manual: { type: 'boolean', default: false, label: '手动伸出 / Manual extend', desc: '无 PLC 命令接管时可手动切换。 / Toggle manually when no PLC output owns either command.' },
    extendTag: { type: 'tag', dir: 'in', stType: 'BOOL', autoWhenDriven: true, default: '', label: '伸出命令 / Extend command', group: 'I/O', desc: '接通时伸出。 / True extends the cylinder.' },
    retractTag: { type: 'tag', dir: 'in', stType: 'BOOL', autoWhenDriven: true, default: '', label: '缩回命令 / Retract command', group: 'I/O', desc: '接通时缩回。两命令断开时保持上一次目标，两命令同时接通时停止。 / True retracts. Both off keeps the last destination, and both on holds position.' },
    extendedTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: '伸出到位反馈 / Extended feedback', group: 'I/O' },
    retractedTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: '缩回到位反馈 / Retracted feedback', group: 'I/O' },
    conflictTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: '命令冲突 / Command conflict', group: 'I/O' },
  },
  rig(p) {
    const bodyLength = p.stroke + 0.1
    const rodLength = p.stroke + 0.04
    const bodyEnd = bodyLength / 2
    const rodX = bodyEnd + 0.018 - rodLength / 2
    const axisHeight = 0.055
    const horizontal = [0, 0, -Math.PI / 2]
    return {
      links: [
        { name: 'base', shape: { kind: 'box', size: [bodyLength + 0.045, 0.02, 0.11] }, offset: [0, 0.01, 0], color: [0.12, 0.15, 0.18] },
        { name: 'barrel', shape: { kind: 'cylinder', radius: 0.043, height: bodyLength }, offset: [0, axisHeight, 0], rotation: horizontal, color: [0.20, 0.43, 0.63] },
        { name: 'gland', shape: { kind: 'cylinder', radius: 0.046, height: 0.016 }, offset: [bodyEnd - 0.002, axisHeight, 0], rotation: horizontal, color: [0.22, 0.24, 0.25] },
        { name: 'rod', shape: { kind: 'cylinder', radius: 0.012, height: rodLength }, offset: [rodX, axisHeight, 0], rotation: horizontal, color: [0.7, 0.73, 0.76] },
        { name: 'tip', parent: 'rod', shape: { kind: 'box', size: [0.028, 0.05, 0.05] }, offset: [0, rodLength / 2 + 0.004, 0], color: [0.31, 0.34, 0.36] },
      ],
      // Joint axis is in the parent frame. The rod's cylinder points along the joint after its rest rotation.
      joints: [{ name: 'stroke', link: 'rod', type: 'prismatic', axis: [1, 0, 0], min: 0, max: p.stroke }],
      bounds: { length: bodyLength + 2 * p.stroke + 0.1, width: 0.11, top: 0.103 },
    }
  },
  step(ctx) {
    const p = ctx.params
    if (progress === null) {
      target = p.manual
      progress = target ? 1 : 0
    }
    const autoExtend = ctx.tagDriven(p.extendTag)
    const autoRetract = ctx.tagDriven(p.retractTag)
    const extend = autoExtend && ctx.readTag(p.extendTag)
    const retract = autoRetract && ctx.readTag(p.retractTag)
    const conflict = extend && retract

    if (autoExtend || autoRetract) {
      if (extend !== retract) target = extend
    } else {
      if (p.manual !== lastManual) target = p.manual
      if (ctx.used()) target = !target
    }
    lastManual = p.manual

    if (!conflict) progress = ctx.approach(progress, target ? 1 : 0, ctx.dt / p.travelTime)
    ctx.joints.stroke = progress * p.stroke
    ctx.report('manual', target)
    if (p.extendedTag) ctx.writeTag(p.extendedTag, progress >= 1)
    if (p.retractedTag) ctx.writeTag(p.retractedTag, progress <= 0)
    if (p.conflictTag) ctx.writeTag(p.conflictTag, conflict)
  },
})


