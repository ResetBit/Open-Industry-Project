// Updates for an installed app: electron-updater against the release bucket (package.json `build.publish`,
// Cloudflare R2 at downloads.openindustryproject.org/desktop/, written by scripts/desktop-release.mjs).
//
// Quiet by design, the same rule as the web's UpdatePrompt: nothing ever restarts on its own. A launch checks
// once (after the window is up, so it never competes with the first frame) and then every few hours. A new
// version downloads in the background. Once it is fully downloaded and its signature checked against the
// publisher in the build's app-update.yml, the page shows a notice with a Restart button (DesktopUpdateToast);
// otherwise it installs on the next quit. Help > Check for Updates... runs the same check and reports the result.
//
// The notice is the page's, never a dialog. A window-modal dialog that waits for an answer also blocks the window
// it belongs to. Measured: the app then ignored being closed (the taskbar's Close, a shutdown) for two minutes,
// where the same app with no dialog up quits in a second. Dialogs are kept for checks the user asked for.
//
// An unpackaged shell never checks: it has no app-update.yml, and it is not an installation to update.

const UPDATE_DELAY_MS = 15 * 1000
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Wire the updater. `getWindow()` is the app window dialogs belong to (or null). Returns
 * { checkInteractive(win) } for the menu item; a no-op object when not packaged.
 */
function setupUpdater({ managedRelease = false, app, dialog, getWindow, notifyReady, text = (english) => english }) {
  const say = (win, opts) => {
    const parent = win && !win.isDestroyed() ? win : getWindow()
    return parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)
  }
  if (!app.isPackaged || managedRelease) {
    return {
      readyVersion: () => null,
      install: () => {},
      checkInteractive: (win) =>
        say(win, {
          type: 'info',
          title: text('Check for Updates', '检查更新'),
          message: managedRelease ? text('Updates are distributed by the administrator.', '此版本由管理员统一分发更新。') : text('Updates are checked only in an installed app.', '更新检查适用于已安装的应用。'),
          detail: managedRelease ? '' : text('This is the development shell; it runs whatever the repo holds.', '当前运行的是开发环境中的源码。'),
          buttons: [text('OK', '确定')],
        }),
    }
  }

  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: (m) => console.log('[update]', m), warn: (m) => console.warn('[update]', m), error: (m) => console.error('[update]', m), debug: () => {} }

  // the version downloaded and waiting to install, announced to the page once per version
  let prompted = null
  autoUpdater.on('update-downloaded', (info) => {
    if (prompted === info.version) return
    prompted = info.version
    notifyReady(info.version)
  })
  // Silent, and relaunch after: quitAndInstall() with no arguments runs the installer's full wizard (install for
  // me or for everyone, the folder ...) in the middle of an update. The installer is one-click per-user anyway
  // (package.json `nsis`), so there is nothing to ask. Install-on-quit is silent by default.
  const install = () => setImmediate(() => autoUpdater.quitAndInstall(true, true))

  const quietCheck = () => autoUpdater.checkForUpdates().catch((e) => console.warn('[update] check failed:', e?.message ?? e))
  setTimeout(quietCheck, UPDATE_DELAY_MS)
  setInterval(quietCheck, UPDATE_INTERVAL_MS)

  return {
    readyVersion: () => prompted,
    install,
    async checkInteractive(win) {
      try {
        const result = await autoUpdater.checkForUpdates()
        const latest = result?.updateInfo?.version
        if (!result || !result.isUpdateAvailable) {
          await say(win, { type: 'info', title: text('Check for Updates', '检查更新'), message: text("You're up to date.", "当前已是最新版本。"), detail: text(`Version ${app.getVersion()} is the latest.`, `${app.getVersion()} 是最新版本。`), buttons: [text('OK', '确定')] })
        } else if (prompted === latest) {
          // already downloaded and put off with Later: offer the restart again, since that is what was asked for
          const { response } = await say(win, {
            type: 'info',
            title: text('Update Ready', '更新已就绪'),
            message: text(`Version ${latest} of ${app.name} is ready.`, `${app.name} ${latest} 已准备好安装。`),
            detail: text('Restart now to update, or it installs the next time you quit the app.', '立即重启以安装更新，或在下次退出应用时安装。'),
            buttons: [text('Restart Now', '立即重启'), text('Later', '稍后')],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
          })
          if (response === 0) install()
        } else {
          await say(win, {
            type: 'info',
            title: text('Check for Updates', '检查更新'),
            message: text(`Version ${latest} is available.`, `版本 ${latest} 已发布。`),
            detail: text("It is downloading now; a notice in the app offers the restart when it's ready.", "正在下载。下载完成后，应用会提示重启。"),
            buttons: [text('OK', '确定')],
          })
        }
      } catch (e) {
        await say(win, { type: 'error', title: text('Check for Updates', '检查更新'), message: text('Could not check for updates.', '无法检查更新。'), detail: String(e?.message ?? e), buttons: [text('OK', '确定')] })
      }
    },
  }
}

module.exports = { setupUpdater }
