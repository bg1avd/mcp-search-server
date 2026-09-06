/**
 * API Key 鉴权模块（零依赖）
 *
 * 为一个"可发布、功能齐备"的独立 MCP 服务器提供 API-key 方案：
 *  - 服务启动时可通过 CLI/env 指定一组已分发的 key
 *  - 每个入站 HTTP 请求校验 `Authorization: Bearer <api-key>`
 *  - key 支持多种来源：环境变量 / 启动参数 / apikeys.json 文件
 *  - 内置一个安全的 key 生成器（CSPRNG）
 *
 * 存储安全：推荐只把 key 的 sha256 摘要存盘（ApikeyStore），运行时比对摘要。
 * 这样即使配置/存储文件泄露，也无法还原明文 key。
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import * as fs from 'node:fs'

/** 常量时间比较 */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** 生成高强度 API key 明文，例如 ms2_xxxxxxxxxxxxxxxx */
export function generateApiKey(prefix = 'ms2_', bytes = 24) {
  return prefix + randomBytes(bytes).toString('base64url')
}

/** sha256 摘要（用于安全存储 / 比对） */
export function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * 鉴权器：持有若干合法 key。比对用 sha256 摘要，避免明文常驻。
 * 兼容三态：
 *   - 未配置任何 key -> `mode 'open'`，拒绝服务（可发布项目默认应关闭 bare）
 *   - 显式传入 keys -> `mode 'closed'`
 *
 * @param {object} opts
 * @param {string[]} [opts.keys]     合法的明文 key（运行时比摘要）
 * @param {string[]} [opts.keyHashes] 合法 key 的 sha256 摘要
 */
export class ApiKeyAuth {
  constructor({ keys = [], keyHashes = [] } = {}) {
    this._hashes = new Set([
      ...(keyHashes || []).map((h) => String(h).toLowerCase()),
      ...(keys || []).map((k) => hashApiKey(String(k))),
    ])
  }

  /** 校验 Authorization Bearer key 是否被许可 */
  verify(authHeader) {
    const given = (authHeader || '').startsWith('Bearer ')
      ? String(authHeader).slice('Bearer '.length).trim()
      : ''
    if (!given) return false
    const h = hashApiKey(given)
    if (this._hashes.has(h)) return true
    // 也支持命中已存的明文摘要集合中任意一个
    return false
  }

  /** 是否配置了至少一个 key */
  get hasKeys() {
    return this._hashes.size > 0
  }
}

/**
 * ApikeyStore：从 JSON 文件读写 key 摘要集合。
 * 当运行在"需把 key 持久化给运营者/撤销某 key"的场景时使用。
 *
 * 文件形如：{ "apiKeys": { "<sha256摘要>": { createdAt, name } } }
 * 明文 key 只在签发时打印一次，之后仅存摘要。
 */
export class ApiKeyStore {
  /**
   * @param {string} filePath json 文件路径
   * @param {object} [fsExtra] 可选注入 fs（测试用）
   */
  constructor(filePath, fsExtra = null) {
    this.filePath = filePath
    this._f = fsExtra || fs
    this._records = {}
  }

  /** 从磁盘载入 */
  async _load() {
    try {
      const raw = await this._f.promises.readFile(this.filePath, 'utf-8')
      const data = JSON.parse(raw)
      this._records = (data && data.apiKeys) || {}
    } catch {
      this._records = {}
    }
    return this
  }

  /** 初始化（显式 load，便于测试注入） */
  async load() {
    return this._load()
  }

  /** 签发一个新 key：返回 {apiKey(明文，仅此一次), hash, name}；同时写盘 */
  async issue({ name = 'default' } = {}) {
    await this._load()
    const apiKey = generateApiKey()
    const hash = hashApiKey(apiKey)
    this._records[hash] = { name, createdAt: new Date().toISOString() }
    await this.persist()
    return { apiKey, hash, name }
  }

  /** 撤销一个 key（按摘要） */
  async revokeByHash(hash) {
    await this._load()
    delete this._records[String(hash).toLowerCase()]
    await this.persist()
  }

  /** 判断某明文 key 是否在册 */
  async has(apiKey) {
    await this._load()
    return Object.prototype.hasOwnProperty.call(this._records, hashApiKey(apiKey))
  }

  /** 落盘 */
  async persist() {
    const dir = this.filePath.includes('/') ? this.filePath.slice(0, this.filePath.lastIndexOf('/')) : '.'
    await this._f.promises.mkdir(dir, { recursive: true })
    await this._f.promises.writeFile(this.filePath, JSON.stringify({ apiKeys: this._records }, null, 2), 'utf-8')
  }
}
