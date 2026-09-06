/**
 * API Key 鉴权 & 存储单测
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { ApiKeyAuth, ApiKeyStore, generateApiKey, hashApiKey, safeEqual } from '../src/auth.js'

test('generateApiKey 前缀 & 唯一', () => {
  const a = generateApiKey('ms2_', 16)
  const b = generateApiKey('ms2_', 16)
  assert.ok(a.startsWith('ms2_'))
  assert.notEqual(a, b)
})

test('hashApiKey 稳定且单向', () => {
  const h1 = hashApiKey('abc')
  const h2 = hashApiKey('abc')
  assert.equal(h1, h2)
  assert.equal(h1.length, 64)
  assert.notEqual(h1, 'abc')
})

test('safeEqual 常量时间与长度不符', () => {
  assert.equal(safeEqual('aaa', 'aaa'), true)
  assert.equal(safeEqual('aaa', 'aab'), false)
  assert.equal(safeEqual('a', 'aa'), false)
  assert.equal(safeEqual(null, 'aa'), false)
})

test('ApiKeyAuth：keys 明文鉴权', () => {
  const auth = new ApiKeyAuth({ keys: ['k1', 'k2'] })
  assert.equal(auth.hasKeys, true)
  assert.equal(auth.verify('Bearer k1'), true)
  assert.equal(auth.verify('Bearer k2'), true)
  assert.equal(auth.verify('Bearer wrong'), false)
  assert.equal(auth.verify(''), false)
  assert.equal(auth.verify('Basic k1'), false)   // 仅支持 Bearer
})

test('ApiKeyAuth：keyHashes 鉴权', () => {
  const a = new ApiKeyAuth({ keyHashes: [hashApiKey('secret')] })
  assert.equal(a.hasKeys, true)
  assert.equal(a.verify('Bearer secret'), true)
  assert.equal(a.verify('Bearer other'), false)
})

test('ApiKeyAuth：无 key -> hasKeys false', () => {
  const a = new ApiKeyAuth({})
  assert.equal(a.hasKeys, false)
})

test('ApiKeyStore：签发、校验、撤销（持久化）', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-search-'))
  const file = path.join(dir, 'apikeys.json')
  try {
    const store = new ApiKeyStore(file)
    const { apiKey } = await store.issue({ name: 'demo' })
    assert.ok(apiKey.startsWith('ms2_'))

    // 新实例从磁盘读取也能校验（不依赖 process runner 单实例）
    const store2 = new ApiKeyStore(file)
    await store2.load()
    assert.equal(await store2.has(apiKey), true)
    assert.equal(await store2.has('wrong'), false)

    // 文件里只存摘要，不含明文
    const raw = await (await import('node:fs')).promises.readFile(file, 'utf-8')
    assert.ok(!raw.includes(apiKey), '明文 key 不应落盘')

    await store2.revokeByHash(hashApiKey(apiKey))
    const store3 = new ApiKeyStore(file)
    assert.equal(await store3.has(apiKey), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
