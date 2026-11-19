/**
 * ms-ra-forwarder 独立 node 服务包入口（server/ 为 fork 新增目录，不修改上游任何文件）。
 *
 * 把上游 Next.js 应用 `app/api/text-to-speech/route.ts` 的语义移植到裸
 * node:http（零框架），核心协议栈逐字取自上游 `service/`（见 src/service/，
 * 仅两处已注释标注的差异：tts-service.ts 剥 zod、client/base.ts 兜底 timer 清理）。
 *
 * 端点：
 * - GET /                   health JSON（宿主就绪探测，永不鉴权）
 * - GET /api/text-to-speech 上游同款：voice/text 必填，rate/pitch/volume
 *                           默认 0/0/100、范围 ±100、非法值 500（上游同语义）
 * - GET /api/ra             旧版 ms-ra-forwarder 兼容：voiceName||voice 二选一，
 *                           rate/pitch/volume 容忍 `+10%` / `-10%` / `10` / 缺省
 *                           形态（越界截断、非法回默认），存量 legado 老包直接
 *                           指过来即可用
 * - GET /api/voices         微软音色列表（选音色用）
 *
 * 鉴权（deny-by-default）：env `MS_RA_FORWARDER_TOKEN`（回落 `TOKEN`）存在时，
 * `/api/*` 一律要求 `Authorization: Bearer <token>`；`/` 永远开放。
 *
 * 配置：PORT（默认 38080，服务包形态专用端口）、HOST（默认 `::`）。
 *
 * 入口双形态（drpy-node 惯例）：宿主 `require('dist/ra-server.cjs')` 后调
 * `start()/stop()` 拉起；直跑 `node dist/ra-server.cjs` 的自启动挂在构建产物的
 * footer（见 build.mjs）——本文件保持纯 ESM 便于类型检查，不在源码里判 require.main。
 */
import * as http from 'node:http'
import { EdgeTTSService } from './service/edge-tts-service'
import type { TTSOptions } from './service/tts-service'

const service = new EdgeTTSService()
const VERSION = '0.1.0'
/**
 * 默认端口：DsPlayer 服务包形态经 server.json manifest 安装，manifest 无 env
 * 透传通道，端口必须包内写死——选 38080 避开常见服务端口（3000/5757/9527/
 * 9321…）。直跑场景可用 PORT env 覆盖。
 */
const DEFAULT_PORT = 38080

/** 业务错误：status 即 HTTP 状态码（上游 route.ts 同款语义）。 */
class HttpError extends Error {
    constructor(readonly status: number, message: string) {
        super(message)
    }
}

function clamp100(value: number): number {
    return Math.max(-100, Math.min(100, value))
}

/** 数值参数解析（上游 parseNumberParam 移植）：缺省用默认值，非法/越界按上游抛 500。 */
function parseNumberParam(
    params: URLSearchParams,
    name: string,
    defaultValue: number,
    min: number,
    max: number,
): number {
    const raw = params.get(name)
    if (raw === null) return defaultValue
    const value = Number(raw)
    if (Number.isNaN(value) || value < min || value > max) {
        throw new HttpError(500, `Invalid ${name} value`)
    }
    return value
}

/** /api/ra 老包数值形态容忍：`+10%` / `-10%` / `10` / 空 → 数字或 null（非法回 null）。 */
function parseLegacyNumber(params: URLSearchParams, name: string): number | null {
    const raw = (params.get(name) ?? '').trim().replace('%', '').replace(/^\+/, '')
    if (raw === '') return null
    const value = Number(raw)
    return Number.isNaN(value) ? null : value
}

/** 合成主路径。legacy=true 走 /api/ra 兼容参数口径。 */
async function synth(
    params: URLSearchParams,
    voiceRaw: string | null,
    legacy: boolean,
): Promise<Buffer> {
    const text = params.get('text') ?? ''
    if (!text) throw new HttpError(400, 'Text is required')
    const voice = (voiceRaw ?? '').trim()
    if (!voice) throw new HttpError(400, 'Voice is required')
    const options: TTSOptions = legacy
        ? {
              voice,
              volume: clamp100(parseLegacyNumber(params, 'volume') ?? 100),
              rate: clamp100(parseLegacyNumber(params, 'rate') ?? 0),
              pitch: clamp100(parseLegacyNumber(params, 'pitch') ?? 0),
          }
        : {
              voice,
              volume: parseNumberParam(params, 'volume', 100, -100, 100),
              rate: parseNumberParam(params, 'rate', 0, -100, 100),
              pitch: parseNumberParam(params, 'pitch', 0, -100, 100),
          }
    const speech = await service.convert(text, options)
    return Buffer.from(speech.audio)
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    if (path === '/') {
        json(res, 200, { ok: true, service: 'ms-ra-forwarder-standalone', version: VERSION })
        return
    }
    if (!path.startsWith('/api/')) {
        json(res, 404, { error: 'Not found' })
        return
    }
    const token = process.env.MS_RA_FORWARDER_TOKEN || process.env.TOKEN || ''
    if (token && req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Unauthorized')
        return
    }
    if (path === '/api/text-to-speech' || path === '/api/ra') {
        const legacy = path === '/api/ra'
        const voice = url.searchParams.get(legacy ? 'voiceName' : 'voice') ?? url.searchParams.get('voice')
        const audio = await synth(url.searchParams, voice, legacy)
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' })
        res.end(audio)
        return
    }
    if (path === '/api/voices') {
        json(res, 200, await service.fetchVoices())
        return
    }
    json(res, 404, { error: 'Not found' })
}

let server: http.Server | undefined

/** 拉起服务（幂等：已监听直接返回同一实例）。HOST='::' 为双栈监听。 */
export function start(
    port = Number(process.env.PORT) || DEFAULT_PORT,
    host = process.env.HOST || '::',
): Promise<http.Server> {
    if (server?.listening) return Promise.resolve(server)
    server ??= http.createServer((req, res) => {
        handle(req, res).catch((e: unknown) => {
            const status = e instanceof HttpError ? e.status : 500
            const message = e instanceof Error ? e.message : String(e)
            if (status >= 500) {
                console.error(`[ra-server] ${req.method} ${req.url} -> ${status}: ${message}`)
            }
            if (!res.headersSent) json(res, status, { error: message })
            else res.end()
        })
    })
    return new Promise((resolve, reject) => {
        server!.once('error', reject)
        server!.listen(port, host, () => {
            console.log(`[ra-server] listening on ${host}:${port}`)
            resolve(server!)
        })
    })
}

/** 停服（宿主清算用；未启动则空操作）。 */
export async function stop(): Promise<void> {
    const s = server
    server = undefined
    if (!s) return
    await new Promise<void>((resolve) => s.close(() => resolve()))
}
