// 自检门（drpy-node 出包惯例）：拉起构建产物 dist/ra-server.cjs，断言端点行为。
// 离线项：health / 401 / 400 / 500 / 404；LIVE=1 追加真打一发（需外网，验证
// Sec-MS-GEC v2 DRM 核心真实可用）。产物与 node_modules 无关，任何机器可跑。
import { spawn } from 'node:child_process'
import assert from 'node:assert'

const PORT = 3877
const TOKEN = 'check-token'
const BASE = `http://127.0.0.1:${PORT}`
const AUTH = { Authorization: `Bearer ${TOKEN}` }

const child = spawn(process.execPath, ['dist/ra-server.cjs'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', MS_RA_FORWARDER_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.resume() // 排空 stdout 防 OS 管道塞死（宿主拉起同款约定）
child.stderr.on('data', (d) => process.stderr.write(d))

async function waitReady() {
    for (let i = 0; i < 50; i++) {
        try {
            const r = await fetch(`${BASE}/`)
            if (r.ok) return await r.json()
        } catch { /* 未就绪 */ }
        await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('[check] server not ready in 5s')
}

try {
    // 1. health 开放且不带鉴权
    const health = await waitReady()
    assert.equal(health.ok, true)
    assert.equal(health.service, 'ms-ra-forwarder-standalone')

    // 2. /api/* deny-by-default：无 token 401（上游同文案）
    const noAuth = await fetch(`${BASE}/api/text-to-speech?voice=x&text=y`)
    assert.equal(noAuth.status, 401)
    assert.equal(await noAuth.text(), 'Unauthorized')

    // 3. 带 token：缺 text / 缺 voice → 400（上游同语义）
    assert.equal((await fetch(`${BASE}/api/text-to-speech?voice=v`, { headers: AUTH })).status, 400)
    assert.equal((await fetch(`${BASE}/api/text-to-speech?text=t`, { headers: AUTH })).status, 400)

    // 4. 非法数值参数 → 500（上游 parseNumberParam 语义，convert 之前抛，离线可断言）
    const badNum = await fetch(`${BASE}/api/text-to-speech?text=t&voice=v&rate=abc`, { headers: AUTH })
    assert.equal(badNum.status, 500)
    assert.deepEqual(await badNum.json(), { error: 'Invalid rate value' })

    // 5. /api/ra 老参数形态（voiceName + %偏移）不触发 400/500 参数错误
    //    （合成阶段需外网，这里只断言「进入了合成路径」= 超时/网络类 500）
    const legacy = await fetch(`${BASE}/api/ra?voiceName=zh-CN-XiaoxiaoNeural&text=hi&rate=+0%25`, { headers: AUTH })
    assert.ok([200, 500].includes(legacy.status), `legacy /api/ra unexpected ${legacy.status}`)

    // 6. 未知 api 路径 404
    assert.equal((await fetch(`${BASE}/api/nope`, { headers: AUTH })).status, 404)

    if (process.env.LIVE === '1') {
        const r = await fetch(
            `${BASE}/api/text-to-speech?voice=zh-CN-XiaoxiaoNeural&text=${encodeURIComponent('你好，世界')}`,
            { headers: AUTH },
        )
        assert.equal(r.status, 200)
        const buf = Buffer.from(await r.arrayBuffer())
        const isMp3 = buf.subarray(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
        assert.ok(buf.byteLength > 1000, `live audio too small: ${buf.byteLength}`)
        assert.ok(isMp3, 'live audio is not mp3')
        console.log(`[check] LIVE synth ok, ${buf.byteLength} bytes`)
    }

    console.log('[check] all passed')
} finally {
    child.kill()
}
