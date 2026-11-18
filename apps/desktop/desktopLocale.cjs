const { readFileSync, writeFileSync } = require('node:fs')

function createDesktopLocale(file) {
  let locale = 'zh-CN'
  try {
    if (readFileSync(file, 'utf8').trim() === 'en') locale = 'en'
  } catch {
    // A fresh profile opens in Simplified Chinese.
  }
  return {
    text: (english, chinese) => locale === 'zh-CN' ? chinese : english,
    use(next) {
      if ((next !== 'en' && next !== 'zh-CN') || next === locale) return
      locale = next
      try {
        writeFileSync(file, locale + '\n', 'utf8')
      } catch {
        // The running app can still use the selected language.
      }
    },
  }
}

const chineseRoles = new Map([
  ['reload', '重新加载'],
  ['forceReload', '强制重新加载'],
  ['toggleDevTools', '切换开发者工具'],
  ['resetZoom', '恢复默认缩放'],
  ['zoomIn', '放大'],
  ['zoomOut', '缩小'],
  ['togglefullscreen', '切换全屏'],
  ['minimize', '最小化'],
  ['close', '关闭窗口'],
  ['quit', '退出'],
  ['windowMenu', '窗口'],
  ['zoom', '缩放窗口'],
  ['front', '将所有窗口置于前台'],
])

function chineseNetworkAction(key, what) {
  const actions = [
    ['plcio listen ', '允许网络上的 PLC 连接到仿真器'],
    ['plcio connect ', '连接 PLC'],
    ['opcua connect ', '连接 OPC UA 服务器'],
    ['eip ', '连接 EtherNet/IP 控制器'],
    ['ads ', '通过 ADS 连接 TwinCAT 运行时'],
    ['opcuaserver network ', '允许网络上的 SCADA 或 HMI 通过 OPC UA 读写仿真器标签，端口'],
  ]
  for (const [prefix, action] of actions) {
    if (key.startsWith(prefix)) return action + ' ' + key.slice(prefix.length)
  }
  return what
}

module.exports = { createDesktopLocale, chineseRoles, chineseNetworkAction }
