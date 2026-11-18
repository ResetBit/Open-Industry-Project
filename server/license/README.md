# OIP 集中 IP 授权服务

服务以连接的来源 IP 判定访问权限，为每个桌面会话分配一份有时限的席位。桌面客户端定期续期，关闭时主动释放。异常退出后，席位到期自动回收。服务端用 Ed25519 签发租约，客户端通过随包提供的公钥校验签名。

## 启动

从仓库根目录打开 PowerShell。准备专用于授权签名的 Ed25519 私钥 PEM，部署时保存在 EXE 和源码目录之外。为桌面构建配置对应的 SPKI 公钥。以下示例只接受本机的请求。

```powershell
$env:OIP_LICENSE_PRIVATE_KEY_FILE = 'C:\OIP-Secrets\license-private.pem'
$env:OIP_LICENSE_ALLOWLIST = '127.0.0.1,::1'
$env:OIP_LICENSE_HOST = '127.0.0.1'
$env:OIP_LICENSE_PORT = '19190'
$env:OIP_LICENSE_MAX_SEATS = '30'
$env:OIP_LICENSE_TTL_MS = '90000'
node .\server\license\index.mjs
```

授权允许列表支持多个 IPv4、IPv6 或 CIDR，以逗号分隔。启用内网访问时，设置服务器的监听地址和实际授权网段，并提供与客户端访问地址相匹配的 TLS 证书文件。使用内网 CA 时需要将 CA 信任配置到客户端所在 Windows 环境及运行时。

| 变量 | 含义 |
| --- | --- |
| OIP_LICENSE_PRIVATE_KEY_FILE | 必填，Ed25519 私钥 PEM 文件 |
| OIP_LICENSE_ALLOWLIST | 必填，授权 IP 与 CIDR 列表 |
| OIP_LICENSE_HOST | 监听地址，默认 127.0.0.1 |
| OIP_LICENSE_PORT | 监听端口，默认 19190 |
| OIP_LICENSE_MAX_SEATS | 并发租约上限，默认 30，最小 25 |
| OIP_LICENSE_TTL_MS | 租约有效期，默认 90000 毫秒，范围 1000 至 300000 |
| OIP_LICENSE_TLS_KEY_FILE | HTTPS 服务私钥 PEM 文件 |
| OIP_LICENSE_TLS_CERT_FILE | HTTPS 服务证书链 PEM 文件 |

HTTP 监听仅允许回环地址。非回环监听需同时设置 TLS 服务密钥与证书。建议让授权客户端直接访问授权服务器。服务以 TCP 对端 IP 作判断，经过 NAT 后会看到转换后的来源 IP，经过反向代理时会看到代理 IP。Forwarded 和 X-Forwarded-For 头不参与判定。

## 席位行为

| 请求 | 请求参数 | 成功响应 |
| --- | --- | --- |
| POST /v1/licenses/acquire | JSON 包含 challenge、requestId | 200，返回 assertion |
| POST /v1/licenses/renew | Bearer 租约令牌，JSON 包含 challenge | 200，返回 assertion |
| POST /v1/licenses/release | Bearer 租约令牌，无请求体 | 204 |

challenge 每次请求使用新的随机值。requestId 由客户端进程生成，并在重复申请时沿用。两者均使用 16 至 128 个 base64url 字符。服务器在来源 IP 和 requestId 相同的情况下返回已有有效租约，避免因网络重试占用额外席位。续期和释放均校验租约所属 IP。

assertion 由两段 base64url 组成，以点号分隔。第一段是含有 token、challenge、issuedAt、expiresAt、ip 的 JSON。第二段是使用 Ed25519 对第一段 ASCII 文本的签名。客户端核对签名、challenge 和有效期后使用租约。

常见响应是 IP 未授权 403、席位已满 409、租约已失效 410。席位在一个服务进程内管理，重启后客户端重新申请。测试验证的是授权租约并发。生产验收还需在目标终端并行打开实际训练场景，检查仿真、保存和联动。

## 验证

```powershell
node --test .\server\license\index.test.mjs
```

测试并发发送 30 个独立授权请求，核对第 31 个被拒绝、释放和到期后可重新申请，以及伪造转发头无法绕过 IP 限制。

## 本机试运行与重新打包

从仓库根目录执行以下命令。第一次准备会在当前 Windows 用户的 LOCALAPPDATA 下建立签名密钥，之后重跑会复用同一把密钥。EXE 仅含授权地址和对应公钥。

```powershell
$oipNode = volta which node
& $oipNode .\server\license\prepare-client.mjs --local
& .\server\license\start-local.ps1
```

授权服务运行时，另开窗口双击 EXE。保留授权窗口，关闭窗口会停止本机服务。实际内网部署时先配置授权服务器、TLS 和真实网段，再从仓库根目录使用以下方式生成客户端配置并重新打包。

```powershell
$oipNode = volta which node
& $oipNode .\server\license\prepare-client.mjs 'https://license.example.org:19190' 'C:\OIP-Secrets\license-public.pem'
```

生产客户端需信任授权服务的证书链。配置文件生成在 apps/desktop/license-config.json，随桌面程序打包。普通未打包的开发窗口可直接运行。打包成品需要授权。正式终端的 25 人以上并行验证使用实际场景、实际网络和至少 25 台或 25 个独立用户终端会话。

## 对接 suzsf-boot

OIP 桌面端通过 suzsf-app-start 申请、续期和释放授权席位。suzsf-app-admin-start 提供后台策略管理，两个启动模块连接同一个 MySQL 库。

桌面授权地址在 `apps/desktop/license-config.json` 的 `serverUrl` 字段。本次地址为 `http://biteam.f1.luyouxia.net:19091/wx`。客户端追加 `/v1/licenses/acquire`、`/v1/licenses/renew` 或 `/v1/licenses/release`，因此发出的路径以 `/wx/v1/licenses/` 开头。Nginx 转发时保留 `/wx`，将续期和释放的 `Authorization` 头传给 Java，并覆盖写入 `X-OIP-Client-IP`。修改授权地址后重新打包，新 EXE 会使用更新的配置。

在 OIP 工程根目录运行以下命令，使用现有的 Ed25519 密钥对，缺失时创建。只将公钥打包进 EXE。Java 的 suzsf-app-start 启动环境中配置 OIP_LICENSE_PRIVATE_KEY_FILE，指向生成的 license-private.pem。

```powershell
$oipNode = volta which node
$keyDir = Join-Path $env:LOCALAPPDATA 'OIP-Suzsf'
& $oipNode .\server\license\prepare-client.mjs --generate-keys $keyDir
$publicKey = Join-Path $keyDir 'license-public.pem'
& $oipNode .\server\license\prepare-client.mjs 'http://biteam.f1.luyouxia.net:19091/wx' $publicKey --allow-insecure-http
```

远程 HTTP 需要显式设置 allowInsecureHttp。改用 HTTPS 时从命令中去掉 --allow-insecure-http，并确保证书受桌面端信任。Java 启动环境、Nginx 转发和真实 IP 检查见 Java 框架的 docs/oip-license/README.md。恢复本机 Node 授权版打包配置时运行 `prepare-client.mjs --local`，本机 Node 服务的接口仍是 `/v1/licenses/...`。

### 同一份开发版 EXE 兼顾本机和公网

打包本机联调版时，可在上述配置命令末尾追加 --local-url 'http://127.0.0.1:8082/wx'。EXE 启动时先探测本机授权入口，探测请求不会申请席位。本机入口可用时，同一个入口负责申请、续期和释放。其他电脑检测不到本机入口时会继续访问 serverUrl。

在开发机用 zwzsTest_env 启动 suzsf-app-start，并在后台启用策略和放行 127.0.0.1。本机请求直达 Java。公网仍经过当前 Nginx 路径，按识别到的访客 IP 授权。

联调 Java 服务时用 POST 验证。浏览器地址栏发送 GET，更新后的 Java 应返回 HTTP 405。以下请求故意发送不完整的 JSON，用于验证路由，避免申请席位。

```powershell
$licenseBase = 'http://biteam.f1.luyouxia.net:19091/wx'
curl.exe -i -sS --max-time 10 -H 'Accept: application/json' -H 'Content-Type: application/json' --data-binary '{' "$licenseBase/v1/licenses/acquire"
```

HTTP 400 和 `{"code":"invalid_request"}` 表示请求已通过来源校验并到达 JSON 解析。HTTP 403 和 `{"code":"ip_denied"}` 时，查看 Java 授权日志中的 `clientIp`、`peer` 和拒绝原因。Java 从 `suzsf-boot` 目录启动时，日志在该目录的 `logs\console-wx.log`。公网白名单填写服务端识别到的公网出口 IP 或 CIDR。`ipconfig` 显示的通常是终端的内网地址。
