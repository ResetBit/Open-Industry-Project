// The desktop app's half of a hand-over (collab/handoff.ts): a browser's Open in Desktop App sent its project, and
// the shell booted this window at `?handoff=<secret>` (apps/desktop/deepLink.cjs). Take the project, ask, and
// import it exactly as File > Import Project would: it opens as a new project, and the one open now is filed under
// Projects first.
//
// The ask is not a formality. The link is web input: any page can fire one, with a document it filled itself, and a
// project carries part code that runs here with the desktop's file and network access. The user is the only one who
// knows whether they just pressed the button, so they are asked before anything is imported.

import { fileOutgoingDocument, supportsDocumentLibrary } from '../project/documentStore'
import { importProjectData } from '../project/projectFile'
import type { EditorStore } from '../store/store'
import { defineMessages, t } from '../../core/i18n'

const M = defineMessages('desktopHandoff', {
  receiving: "Receiving a project from your browser",
  receivingDetail: "It opens here as soon as it arrives.",
  notReceived: "Nothing arrived from the browser",
  notReceivedDetail: "The project did not reach this app. Check that this computer is online, then try Open in Desktop App again.",
  kept: "The project you have open now is kept under Projects.",
  replaced: "It replaces the project you have open now.",
  question: "Open \"{name}\" from your browser?\n\nIt opens here as a new project, separate from the browser's copy. {kept}\n\nOnly continue if you just chose Open in Desktop App in your browser: a project can carry part code that runs on this computer.",
})

/** Take the address bar's `?handoff=` away, so a reload is an ordinary one rather than a second hand-over. */
function forgetHandoffParam(): void {
  const url = new URL(location.href)
  url.searchParams.delete('handoff')
  history.replaceState(history.state, '', url)
}

export async function receiveDesktopHandoff(store: EditorStore, secret: string): Promise<void> {
  forgetHandoffParam()
  store.showSaveNotice(t(M.receiving), t(M.receivingDetail))
  const { receiveHandoff } = await import('../../collab/handoff')
  const handoff = await receiveHandoff(secret)
  if (!handoff) {
    store.showSaveNotice(
      t(M.notReceived),
      t(M.notReceivedDetail),
    )
    return
  }
  store.dismissSaveNotice()
  const kept = t(supportsDocumentLibrary() ? M.kept : M.replaced)
  const ask = t(M.question, { name: handoff.name, kept })
  if (!confirm(ask)) return
  const error = await importProjectData(store, handoff.oip, { beforeAdopt: () => fileOutgoingDocument(store.outgoingProject()) })
  if (error) alert(error)
}
