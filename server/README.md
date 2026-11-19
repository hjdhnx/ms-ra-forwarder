# ms-ra-forwarder 独立 node 服务包

> 本目录为 fork **新增**（不修改上游任何文件，保证 GitHub「Sync fork」零冲突）。
> 把上游 Next.js 应用的 Edge TTS 核心抽成**零框架、单文件**的 node HTTP 服务：
> 核心协议栈（`src/service/`）逐字取自上游 `service/`，仅两处已注释标注的差异
> （`tts-service.ts` 剥 zod、`edge-tts-service/client/base.ts` 兜底 timer 清理）。
>
> ⚠️ 与上游一致：本项目仅供学习参考，请勿商用；微软 Edge「大声朗读」为非官方
> 免费接口，随时可能收紧（上游 2026-10 曾两度修复 Sec-MS-GEC 令牌变更）。

## 为什么要有它

上游完整应用（Next.js + React UI）部署重、依赖多；而「跟微软 DRM 对抗」的协议
核心集中在 `service/` 里，值得单独跑——本目录即该核心的最小 HTTP 壳：

- 产物 `dist/ra-server.cjs` **单文件**，目标机 `node dist/ra-server.cjs` 即跑
  （Node ≥ 18，无需 node_modules）
- 兼容上游 `/api/text-to-speech` 新端点 + 旧版 `/api/ra` 老端点（存量 legado
  老包直接指过来可用）
- 鉴权 / 参数语义与上游 route.ts 对齐，错误码一致

## 快速开始

```bash
npm install          # 仅构建期需要（esbuild/typescript）；运行时零依赖
npm run build        # → dist/ra-server.cjs
npm run check        # 自检门：拉起产物断言 health/401/400/500/404（离线）
LIVE=1 npm run check # 自检门 + 真打一发合成（需外网，验证 DRM 核心可用）
npm run dev          # build + 直跑（默认 ::38080）
```

部署（任选）：

```bash
node dist/ra-server.cjs                       # 直跑
PORT=3777（任意端口均可） HOST=127.0.0.1 node dist/ra-server.cjs
pm2 start dist/ra-server.cjs --name ra-forwarder
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `38080` | 监听端口 |
| `HOST` | `::` | 监听地址（双栈） |
| `MS_RA_FORWARDER_TOKEN` | 无 | 设置后 `/api/*` 要求 `Authorization: Bearer <token>`（回落 `TOKEN`）；`/` 永远开放 |
| `EDGE_TTS_DEBUG` | 无 | `1` = 详细 WS 协议日志（上游同款） |

## 端点

| 端点 | 说明 |
|---|---|
| `GET /` | health JSON（宿主就绪探测），如 `{"ok":true,"service":"ms-ra-forwarder-standalone","version":"0.1.0"}` |
| `GET /api/text-to-speech?voice=zh-CN-XiaoxiaoNeural&text=你好&rate=0&volume=100&pitch=0` | 上游同款：`voice`/`text` 必填，`rate/pitch/volume` 缺省 `0/0/100`、范围 ±100、非法值 500 |
| `GET /api/ra?voiceName=zh-CN-XiaoxiaoNeural&text=你好&rate=+0%` | 旧版兼容：`voiceName`（回落 `voice`）、数值容忍 `+10%`/`-10%`/`10`/缺省 |
| `GET /api/voices` | 微软音色列表 JSON（选音色用） |

```bash
curl "http://127.0.0.1:38080/api/text-to-speech?voice=zh-CN-XiaoxiaoNeural&text=%E4%BD%A0%E5%A5%BD" -o out.mp3
```

返回 `audio/mpeg`（audio-24khz-96kbitrate-mono-mp3，与上游一致）；错误为 JSON
`{"error":"..."}`（400 参数缺失 / 401 鉴权 / 500 合成失败或参数非法）。

## 导入 DsPlayer（网络音色包）

DsPlayer 阅读设置 → 网络朗读 → 导入音色包，粘贴（本服务自建实例为例）：

```json
[{"name":"晓晓(自建)","contentType":"audio/mpeg","header":"","url":"http://127.0.0.1:38080/api/text-to-speech?voice=zh-CN-XiaoxiaoNeural&rate=0&volume=100&pitch=0&text={{speakText}}"}]
```

注意：`{{...}}` 内只支持 `{{speakText}}/{{speakSpeed}}/{{vol}}/{{pitch}}` 四个
变量直替；ms-ra-forwarder 网页导出的 legado 链接含 `{{(speakSpeed - 10) * 2}}`
等 JS 表达式，DsPlayer 不执行（导入时会提示跳过）——把 `rate` 写死为数字即可。
legado 等支持表达式的消费方不受此限。

## 宿主拉起约定（供嵌入方参考）

`dist/ra-server.cjs` 为 CJS 单文件，导出 `start()/stop()`（drpy-node 入口双形态
惯例）：

```js
const srv = require('./dist/ra-server.cjs')
await srv.start(3777, '127.0.0.1')   // 或依赖 PORT/HOST env 直跑自启动
await srv.stop()
```

拉起方注意：合并系统环境变量（裸 env 缺 `SystemRoot` 会坏 Windows 网络栈）、
排空子进程 stdout（OS 管道 ~64KB 塞死会卡住 listen）、就绪探测轮询 `GET /`。

## DsPlayer 服务包（插件市场 `type: server`）

以 `ra-tts` 条目上架 DsPlayer 插件市场：zip = 根部 `server.json` manifest +
`ra-server.cjs` 产物。安装后解压至 `server/node/ra-tts/` 并自动创建「Edge 朗读
TTS」服务（需先装 nodejs / nodejs-win 运行时插件），默认端口 **38080**（manifest
无 env 透传，端口包内写死）。上架物料生成（在 server/ 目录）：

```bash
npm run build && python pack.py   # dist/ra-tts-0.1.0.zip + md5 打印
```

服务启动后，DsPlayer 网络音色包按上文模板填 `http://127.0.0.1:38080/...`。

## 与上游同步

上游修 DRM（`service/edge-tts-service/**`）后：

```bash
git -C <本仓> fetch upstream
diff <(git show upstream/master:service/edge-tts-service/client/base.ts) server/src/service/edge-tts-service/client/base.ts
```

逐文件对照拷入 `server/src/service/`（保持目录层级一致则 import 零改动），注意
保留两处本地差异：`tts-service.ts` 的 zod 剥离、`base.ts` 的 timer 清理。改完
`npm run check`（有网再加 `LIVE=1`）即完成回归。

## 文件说明

```
server/
├── src/server.ts        # 裸 node:http 壳（端点/鉴权/参数解析，~190 行）
├── src/service/         # 上游核心逐字拷贝（除两处标注差异）
├── build.mjs            # esbuild → dist/ra-server.cjs（自启动挂在 footer）
├── check.mjs            # 自检门（LIVE=1 含真实合成）
├── pack.py              # 服务包打包（zip + server.json manifest → 市场物料）
└── package.json         # 运行时 deps 仅 ws/fast-xml-parser/axios；产物单文件
```
