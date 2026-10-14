/**
 * streamable-http MCP 服务器（零依赖，Node http）
 *
 * 特性：
 *  - 基于 MCP Streamable HTTP 传输：POST JSON 请求，回 JSON 或 text/event-stream。
 *  - API Key 鉴权：`Authorization: Bearer <key>`；未配置 key 时默认拒绝，防止裸跑公网。
 *  - 无第三方依赖，可直接 node 起服务或作为库被 import。
 */

import { createServer } from 'node:http'
import { ApiKeyAuth, ApiKeyStore } from './auth.js'
import { handleRpc } from './protocol.js'

const MAX_BODY = 2 * 1024 * 1024

/** 读取请求体（限长，防恶意超大 body） */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        req.destroy()
        reject(new Error('payload too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

export function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** 写一条 SSE `event: message` 帧 */
function sseMessage(res, json) {
  res.write(`event: message\ndata: ${JSON.stringify(json)}\n\n`)
}

/**
 * 启动 streamable-http MCP 搜索服务器。
 *
 * @param {object} cfg
 * @param {number}  [cfg.port=7314]
 * @param {string}  [cfg.host='127.0.0.1']
 * @param {string[]} [cfg.keys]        允许的 API key（推荐方式，运行时摘要比对）
 * @param {string}  [cfg.apiKeysFile]  备选：持有摘要的 apikeys.json（由 CLI `keygen` 生成）
 * @param {boolean} [cfg.allowNoAuth]  开发态开关：无 key 时也放行。默认 false
 * @param {Function}[cfg.logger]
 * @param {Function}[cfg.dispatch]     覆盖 handleRpc（测试注入用）
 * @param {string}  [cfg.searxngBase]  SearXNG 实例根地址（方案 A 后端：查询走它）
 * @param {boolean} [cfg.noFallback]   true = 只用 SearXNG，不降级到 Bing（宁可失败也不给降级结果）
 * @returns {Promise<import('node:http').Server>} （返回前会完成 auth 加载 / listen）
 */
export async function startMcpServer(cfg = {}) {
  const {
    port = 7314,
    host = '127.0.0.1',
    keys = [],
    apiKeysFile = '',
    allowNoAuth = false,
    logger = (...a) => console.log(...a),
    dispatch = handleRpc,
    searxngBase = '',
    noFallback = false,
  } = cfg

  // 默认 dispatch 若不支持 ctx，就包一层把后端配置传进去
  const rpcDispatch = (msg) => dispatch(msg, { searxngBase, noFallback })

  // ---- 鉴权策略 ----
  let authHasKeys = false
  let verify = () => false
  if (keys && keys.length) {
    const a = new ApiKeyAuth({ keys })
    authHasKeys = a.hasKeys
    verify = (h) => a.verify(h)
  } else if (apiKeysFile) {
    const store = new ApiKeyStore(apiKeysFile)
    await store.load()
    const hashes = Object.keys(store._records || {}).filter((h) => /^[0-9a-f]{64}$/.test(h))
    const a = new ApiKeyAuth({ keyHashes: hashes })
    authHasKeys = a.hasKeys
    verify = (h) => a.verify(h)
  }

  const locked = !(authHasKeys || allowNoAuth) // 未配 key 且不允许无鉴权 → 锁死业务

  const server = createServer(async (req, res) => {
    // 1) 鉴权
    if (!locked) {
      if (authHasKeys && !verify(req.headers['authorization'])) {
        sendJson(res, 401, {
          jsonrpc: '2.0',
          error: { code: -32001, message: 'unauthorized: invalid or missing API key' },
        })
        return
      }
    } else {
      sendJson(res, 503, {
        jsonrpc: '2.0',
        error: {
          code: 'NO_API_KEY',
          message: '服务器未配置 API key。请用 --keys <k> 运行或先用 `mcp-search-server keygen` 生成，再以 --api-keys-file 启动；或仅开发时加 --allow-no-auth。',
        },
      })
      return
    }

    const method = req.method || ''

    // 2) streamable-http GET：给客户端一条可选 SSE 握手
    if (method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      sseMessage(res, { jsonrpc: '2.0', result: {}, id: null })
      req.on('close', () => res.end())
      return
    }

    // 3) POST JSON-RPC
    if (method === 'POST') {
      let raw
      try {
        raw = await readBody(req)
      } catch {
        sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'parse error' } })
        return
      }
      let msg
      try {
        msg = JSON.parse(raw || '{}')
      } catch {
        sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'invalid json' } })
        return
      }
      let reply
      try {
        reply = await rpcDispatch(msg)
      } catch (e) {
        sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: (e && e.message) || 'internal' } })
        return
      }
      if (reply == null) {
        // 通知 → 202 空
        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end('{"jsonrpc":"2.0"}')
        return
      }
      const acceptsSse = (req.headers.accept || '').includes('text/event-stream')
      if (acceptsSse) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'close',
        })
        sseMessage(res, reply)
        res.end()
        return
      }
      sendJson(res, 200, reply)
      return
    }

    res.writeHead(405).end()
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeAllListeners('error')
      resolve()
    })
  })

  const mode = authHasKeys ? 'api-key auth' : (allowNoAuth ? 'open (dev only)' : 'LOCKED (no key)')
  logger(`[mcp-search] streamable-http listening on http://${host}:${port}  [${mode}]`)
  return server
}
