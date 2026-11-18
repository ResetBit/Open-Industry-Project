import { useSyncExternalStore } from 'react'
import { keymapRev, subscribeKeymap } from '../../core/keymap'
import { keyHint, primaryKey } from '../keyHint'
import { defineMessages, t } from '../../core/i18n'

const M = defineMessages('pilotHud', {
  help: '{move} move · {interact} interact · {exit} exit',
})

/** First-person Pilot Mode overlay: a fixed crosshair, a context prompt, and a controls hint. */
export function PilotHud({ prompt }: { prompt: string | null }) {
  useSyncExternalStore(subscribeKeymap, keymapRev)
  const move = ['pilot.forward', 'pilot.left', 'pilot.back', 'pilot.right'].map((id) => primaryKey(id)).join(' ')
  const interact = keyHint('pilot.interact') ?? ''
  const exit = keyHint('pilot.exit') ?? ''
  const useKey = primaryKey('pilot.interact')
  return (
    <div className="pilot-hud">
      <div className="pilot-crosshair" />
      {prompt && (
        <div className="pilot-prompt">
          {useKey && <kbd>{useKey}</kbd>} {prompt}
        </div>
      )}
      <div className="pilot-help">{t(M.help, { move, interact, exit })}</div>
    </div>
  )
}
