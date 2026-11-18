// Save (Ctrl+S, and the toolbar's Save): one command that behaves the same on every surface. The
// project already saves itself as you go, so Save writes anything still pending and, on the first Save of
// the page, says where the work is. Only that location differs.
//
//   desktop, or a folder synced both ways -> the folder (projectFolderSync; "Saved", or a banner)
//   browser                               -> this browser's storage, with "Download a copy" beside it
//   a live room                           -> the room, which saves for everyone as they work
//
// The app binds Ctrl+S in the browser too, or it reaches the browser's own "Save page as" and saves the
// app's HTML. Save never downloads one scene: that reads as saving the project and is not.
//
// Not "download a file every time": a Downloads folder full of project (3).oip is not a
// save, nothing reopens those, and the work is already stored. The copy is one click away, offered at
// the moment someone is thinking about keeping their work, instead of as a warning on a first visit.

import { saveProjectNow, showSaveNoticeOnce } from '../desktop/desktopProjectBridge'
import { syncedFolderPath, supportsFolderSync } from './projectFolderSync'
import type { SceneSwapGuard } from './projectFolderLink'
import type { EditorStore } from '../store/store'
import { defineMessages, t } from '../../core/i18n'

const M = defineMessages('projectSave', {
  sharedTitle: "Saved as you work",
  sharedDetail: "Changes in a shared project save for everyone as they are made.",
  copy: "Make a copy",
  browserTitle: "Saved in this browser",
  browserDetail: "Your work saves here as you go. Download a copy to keep it outside the browser.",
  download: "Download a copy",
})

export async function saveProject(store: EditorStore, controller: SceneSwapGuard = null): Promise<void> {
  const state = store.getState()
  if (state.readOnly) return
  if (state.collab) {
    showSaveNoticeOnce(store, t(M.sharedTitle), t(M.sharedDetail), {
      label: t(M.copy),
      command: 'file.copyRoom',
    })
    return
  }
  if (supportsFolderSync() || syncedFolderPath() !== null) return saveProjectNow(store, controller)
  // The browser: the working copy is the save. On the demo preview, Save can only mean "keep this", so it
  // keeps a copy first. That fork announces itself, so no second toast is stacked on it.
  const forked = state.demoSession
  if (forked) store.keepDemoCopy()
  const saved = store.persistProject()
  if (!saved.ok || forked) return // a failed save raises the autosave banner, which says why
  showSaveNoticeOnce(store, t(M.browserTitle), t(M.browserDetail), {
    label: t(M.download),
    command: 'file.exportProject',
  })
}
