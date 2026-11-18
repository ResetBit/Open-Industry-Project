import type { Lesson } from './lessons'

const KEY = 'oip-web/open-training'

export function setTrainingLaunch(lessonId: Lesson['id'] | null): void {
  try {
    if (lessonId === null) sessionStorage.removeItem(KEY)
    else sessionStorage.setItem(KEY, lessonId)
  } catch {
    // The task itself is persisted with the editor's project.
  }
}

export function takeTrainingLaunch(): Lesson['id'] | undefined {
  try {
    const value = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return value === null ? undefined : value as Lesson['id']
  } catch {
    return undefined
  }
}
