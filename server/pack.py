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
            '&rate=0&volume=100&pitch=0&text={{speakText}}。仅供学习，请勿商用。',
}

out = Path('dist') / f'ra-tts-{VERSION}.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('server.json', json.dumps(MANIFEST, ensure_ascii=False, indent=2) + '\n')
    z.writestr('ra-server.cjs', Path('dist/ra-server.cjs').read_bytes())

md5 = hashlib.md5(out.read_bytes()).hexdigest()
print(f'[pack] {out} {out.stat().st_size / 1024:.1f}KB md5={md5}')
