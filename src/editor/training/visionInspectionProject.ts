import { defineMessages, t } from '../../core/i18n'
import type { ProjectJSON } from '../../core/project/project'
import { SCENE_VERSION } from '../../core/types'
import { assembleProject } from '../project/projectFile'
import { VISION_LESSON_GANTRY, VISION_LESSON_LIGHT, VISION_LESSON_TARGET } from '../vision/profile'

const M = defineMessages('visionInspectionProject', {
  title: 'Vision-guided workpiece sorting',
  red: 'Red inspection workpiece',
  blue: 'Blue reference workpiece',
  gantry: 'Sorting gantry',
  light: 'Inspection status tower',
  test: 'A valid inspection position drives a physical pick and place',
  reject: 'A missing target prevents gantry movement',
})

const program = `VAR_INPUT
  VisionDone, VisionFound, VisionFault : BOOL;
  VisionX, VisionZ : REAL;
  GantryFault : BOOL;
  ActualX, ActualY, ActualZ : REAL;
END_VAR
VAR_OUTPUT
  VisionRequest, GantryRun, Vacuum : BOOL;
  TargetX, TargetY, TargetZ : REAL;
  Lamps, SortCode : INT;
END_VAR
VAR
  Stage : INT;
  PickX, PickZ : REAL;
END_VAR

VisionRequest := Stage = 0;
GantryRun := Stage >= 10 AND Stage <= 50 AND NOT GantryFault;
Lamps := 2;

CASE Stage OF
  0:
    IF VisionDone THEN
      VisionRequest := FALSE;
      IF VisionFound AND NOT VisionFault AND ABS(VisionX) < 1.2 AND ABS(VisionZ) < 0.8 THEN
        PickX := VisionX;
        PickZ := VisionZ;
        Stage := 10;
      ELSE
        Stage := 90;
      END_IF;
    END_IF;
  10:
    TargetX := PickX; TargetY := PickZ; TargetZ := 0.46;
    IF ABS(ActualX - TargetX) < 0.015 AND ABS(ActualY - TargetY) < 0.015 AND ABS(ActualZ - TargetZ) < 0.015 THEN
      Vacuum := TRUE;
      Stage := 20;
    END_IF;
  20:
    TargetZ := 0.0;
    IF ActualZ < 0.015 THEN
      Stage := 30;
    END_IF;
  30:
    TargetX := 1.25; TargetY := -0.45;
    IF ABS(ActualX - TargetX) < 0.015 AND ABS(ActualY - TargetY) < 0.015 THEN
      Stage := 40;
    END_IF;
  40:
    TargetZ := 0.46;
    IF ABS(ActualZ - TargetZ) < 0.015 THEN
      Vacuum := FALSE;
      Stage := 50;
    END_IF;
  50:
    TargetZ := 0.0;
    IF ActualZ < 0.015 THEN
      Stage := 60;
      SortCode := 1;
    END_IF;
  60:
    Lamps := 1;
  90:
    Lamps := 4;
END_CASE;

IF GantryFault THEN
  GantryRun := FALSE;
  Stage := 90;
  Lamps := 4;
END_IF;`

export function createVisionInspectionProject(): ProjectJSON {
  const project = assembleProject({
    version: SCENE_VERSION,
    parts: [
      { id: VISION_LESSON_GANTRY, type: 'part', packageId: 'oip.gantry', name: t(M.gantry),
        position: [0, 0, 0], rotationY: 0, params: {
          mode: 'follow', executeTag: 'GantryRun', targetXTag: 'TargetX', targetYTag: 'TargetY', targetZTag: 'TargetZ',
          gripperTag: 'Vacuum', faultTag: 'GantryFault', actualXTag: 'ActualX', actualYTag: 'ActualY', actualZTag: 'ActualZ',
        } },
      { id: VISION_LESSON_TARGET, type: 'part', packageId: 'oip.box', name: t(M.red),
        position: [-0.65, 0.15, 0.32], rotationY: 0,
        params: { length: 0.3, width: 0.3, height: 0.3, color: '#d42b22', mass: 5 } },
      { id: 'vision-inspection-reference', type: 'part', packageId: 'oip.box', name: t(M.blue),
        position: [0.55, 0.15, 0.5], rotationY: 0,
        params: { length: 0.3, width: 0.3, height: 0.3, color: '#1d62db', mass: 5 } },
      { id: VISION_LESSON_LIGHT, type: 'part', packageId: 'oip.stack-light', name: t(M.light),
        position: [1.6, 0, 0.7], rotationY: 0, params: { segments: 3, value: 2, tag: 'Lamps' } },
    ],
  }, program, [], t(M.title))
  return {
    ...project,
    tests: [{
      name: t(M.test), duration: 16,
      inputs: [
        { at: 0.2, tag: 'VisionX', value: -0.65 }, { at: 0.2, tag: 'VisionZ', value: 0.32 },
        { at: 0.2, tag: 'VisionFound', value: true }, { at: 0.2, tag: 'VisionDone', value: true },
      ],
      checks: [
        { at: 0.1, tag: 'VisionRequest', equals: true },
        { at: 0.4, tag: 'VisionRequest', equals: false },
        { eventually: true, tag: 'SortCode', equals: 1 },
        { eventually: true, probe: { pose: { part: VISION_LESSON_TARGET, axis: 'y' } }, min: 0.4 },
        { at: 15.5, probe: { pose: { part: VISION_LESSON_TARGET, axis: 'x' } }, min: 1.15 },
      ],
    }, {
      name: t(M.reject), duration: 1.5,
      inputs: [{ at: 0.2, tag: 'VisionDone', value: true }],
      checks: [
        { at: 0.5, tag: 'Lamps', equals: 4 },
        { always: true, tag: 'GantryRun', equals: false },
        { always: true, tag: 'SortCode', equals: 0 },
      ],
    }],
  }
}
