#!/usr/bin/env node
/**
 * mcp-search-server CLI
 *
 *   mcp-search-server serve --port 7394 --host 0.0.0.0 --keys=xxx[,yyy]
 *      或  --api-keys-file ./apikeys.json   (由 keygen 生成/管理)
 *      或  API_KEYS=xxx,yyy (环境变量) ；
 *      开发态才加 --allow-no-auth（勿公网用）
 *
 *   mcp-search-server keygen --file ./apikeys.json [--name demo]
 *     生成新 API key：把【明文 key】打印一次、将摘要写盘
 *
 * Zero dependency, ESM.
 */
import { startMcpServer } from './server.js'
import { ApiKeyStore } from './auth.js'

function parseArgv(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const eq = a.startsWith('--') && a.includes('=')
    if (eq) {
      const [k, v] = a.slice(2).split('=')
      flags[k] = v
      continue
    }
    if (a === '--allow-no-auth') { flags['allow-no-auth'] = true; continue }
    if (a.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      flags[a.slice(2)] = argv[++i]
      continue
    }
    if (!flags._cmd) flags._cmd = a
  }
  return flags
}

async function main() {
  const f = parseArgv(process.argv.slice(2))
  const cmd = f._cmd || (process.env.MCP_SEARCH_CMD)

  if (!cmd || (cmd !== 'serve' && cmd !== 'keygen' && !cmd.startsWith('key'))) {
    // 无子命令或拼错 → 打印用法
    console.log(`mcp-search-server v${(await import('./protocol.js')).SERVER_VERSION}

用法：
  mcp-search-server keygen [--file apikeys.json] [--name demo]
      生成 API key（明文打印一次；文件只存 sha256 摘要）

  mcp-search-server serve --port 7394 --host 0.0.0.0 \
       --keys=<k1>[,<k2>]            # 直给 key
       # 或
       --api-keys-file ./apikeys.json # 用 keygen 生成的文件
       [--allow-no-auth]             # 仅开发态；勿公网
`)
    return
  }

  if (cmd === 'keygen') {
    const file = f.file || f['file'] || process.env.API_KEYS_FILE || './apikeys.json'
    const store = new ApiKeyStore(file)
    const out = await store.issue({ name: f.name || 'default' })
    console.log('\n=== 新 API Key（仅此一次显示，请妥善保存） ===')
    console.log(out.apiKey)
    console.log(`\n明文已只存 sha256 摘要于：${file}`)
    console.log('启动时用：--api-keys-file ' + file)
    return
  }

  if (cmd === 'serve') {
    const port = parseInt(f.port || process.env.PORT || '7394', 10)
    const host = f.host || process.env.HOST || '0.0.0.0'
    const allowNoAuth = Boolean(f['allow-no-auth'] || process.env.ALLOW_NO_AUTH)

    let keys = []
    if (f.keys) keys = String(f.keys).split(',').map((s) => s.trim()).filter(Boolean)
    else if (process.env.API_KEYS) keys = process.env.API_KEYS.split(',').map((s) => s.trim()).filter(Boolean)

    const apiKeysFile = f['api-keys-file'] || process.env.API_KEYS_FILE

    // 搜索后端：目标 SearXNG 实例（方案 A）。可用 --searxng-url 或环境变量 SEARXNG_URL。
    const searxngBase = f['searxng-url'] || process.env.SEARXNG_URL || ''

    console.log(`[mcp-search] serve cmd; keys=${keys.length} apiKeysFile=${apiKeysFile || '(none)'} searxng=${searxngBase || '(未配置→默认 bing 兜底)'} allowNoAuth=${allowNoAuth} port=${port}`)
    await startMcpServer({ port, host, keys, apiKeysFile, allowNoAuth, searxngBase })
    return
  }

  console.error('未知命令：' + cmd)
  console.error('用法：mcp-search-server (serve|keygen) [options]')
  process.exitCode = 1
}

main().catch((e) => {
  console.error('启动失败：', e && e.message ? e.message : e)
  process.exit(1)
})
