// 构建脚本：src/server.ts → dist/ra-server.cjs 单文件（零 node_modules 运行时）。
// 直跑自启动通过 footer 注入——源码保持纯 ESM 便于 tsc --noEmit 类型检查。
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })

await build({
    entryPoints: ['src/server.ts'],
    outfile: 'dist/ra-server.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    // ws 的可选原生加速件：缺失时 ws 内部 try/catch 自动降级，必须 external
    // （未安装的原生包打不进 bundle，留 require 运行时探测）。
    external: ['bufferutil', 'utf-8-validate'],
    banner: {
        js: '/*! ms-ra-forwarder standalone server | fork 新增（server/），核心逐字取自上游 service/ | 仅供学习 */',
    },
    footer: {
        js: [
            '',
            ';/* 直跑自启动（宿主 require 后请显式调 start()/stop()）*/',
            ';if (require.main === module) {',
            '  module.exports.start().catch((e) => { console.error("[ra-server] start failed:", e); process.exit(1) });',
            '}',
        ].join('\n'),
    },
    logLevel: 'info',
})

console.log('[build] dist/ra-server.cjs ok')
