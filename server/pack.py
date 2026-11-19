# -*- coding: utf-8 -*-
"""服务包打包：dist/ra-server.cjs + server.json → dist/ra-tts-<版本>.zip。

DsPlayer 插件市场 type=server 条目物料；zip 根部 server.json manifest 由
ServerPackageInstaller 消费（workDir/entry/port 字段契约）。stdlib zipfile
打包（Local File Header 与 Central Directory 分隔符一致恒 `/`——PS5.1
Compress-Archive 会写 `\`，勿换）。
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

VERSION = sys.argv[1] if len(sys.argv) > 1 else json.loads(
    Path('package.json').read_text(encoding='utf-8'))['version']

MANIFEST = {
    'workDir': 'ra-tts',
    'entry': 'ra-server.cjs',
    'port': 38080,
    'runtime': 'node',
    'autoStart': False,
    'serviceName': 'Edge 朗读 TTS',
    'desc': '微软 Edge 朗读 TTS 转发（ms-ra-forwarder 核心单文件版）。启动后网络音色包填 '
            'http://127.0.0.1:38080/api/text-to-speech?voice=zh-CN-XiaoxiaoNeural'
            '&rate={{speakSpeedPct}}&volume=100&pitch=0&text={{speakText}}。仅供学习，请勿商用。',
}

USAGE_TXT = '''Edge 朗读 TTS 服务（ms-ra-forwarder 核心单文件版）
=====================================================

端口：38080（写死；直跑可用 PORT env 覆盖，服务包形态无 env 通道）
鉴权：默认关闭；需启用时在服务配置 env 加 MS_RA_FORWARDER_TOKEN=<值>，
      请求头带 Authorization: Bearer <值>

端点：
  GET /                          health JSON（服务页探活也用它）
  GET /api/voices                318 个微软音色列表
  GET /api/text-to-speech?voice=zh-CN-XiaoxiaoNeural&text=你好
                                 &rate=0&volume=100&pitch=0（±100 偏移）
  GET /api/ra?voiceName=…&text=… 旧版 ms-ra-forwarder 兼容（容忍 +10% 形态）

DsPlayer 接入：阅读 → 设置 → 朗读引擎切「网络」→ 导入音色包：
  [{"name":"晓晓(本地TTS)","contentType":"audio/mpeg",
    "url":"http://127.0.0.1:38080/api/text-to-speech?voice=zh-CN-XiaoxiaoNeural&rate={{speakSpeedPct}}&volume=100&pitch=0&text={{speakText}}"}]

换音色：把 voice= 换成 /api/voices 里任意 ShortName（如 YunyangNeural）。
仅供学习参考，请勿商用。
'''

out = Path('dist') / f'ra-tts-{VERSION}.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    # server.json 是安装指令（根部，安装器过滤不落盘）；产物必须活在
    # workDir 同名目录下——安装器解压根 = server/node/，服务配置的
    # workDir = server/node/ra-tts，平铺在根部会「工作目录不存在」（0.1.0 实锤）
    z.writestr('server.json', json.dumps(MANIFEST, ensure_ascii=False, indent=2) + '\n')
    z.writestr('ra-tts/ra-server.cjs', Path('dist/ra-server.cjs').read_bytes())
    z.writestr('ra-tts/README.txt', USAGE_TXT)

md5 = hashlib.md5(out.read_bytes()).hexdigest()
print(f'[pack] {out} {out.stat().st_size / 1024:.1f}KB md5={md5}')
for n in zipfile.ZipFile(out).namelist():
    print('  ', n)
