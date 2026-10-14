/**
 * Bing 兜底后端：跳转链接解码 + 降级检测 + 降级声明（v0.1.3）
 *
 * 背景（实测）：被风控的数据中心 IP 上，Bing 会返回"品牌首页集合"——
 * 查询 "OpenAI API reasoning_effort" 得到的是 openai.com / chatgpt.com / GPT-4 页，
 * 而且 URL 是 `bing.com/ck/a?...&u=a1<base64url>` 这种**无法直接使用**的跳转链接。
 * 旧实现原样端给使用者 → 看起来搜到了、实际是垃圾。
 *
 * 本测试锁死：
 *   ① 跳转链接能被解码成真实 URL
 *   ② 全域名首页 / 有无法解码的跳转 → 判为 degraded
 *   ③ runSearch 在降级时会**显式声明**（原因 + 质量警告），不再静默
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeBingRedirect, isBingRedirect, isDomainRoot, parseBing, assessBingQuality } from '../src/bing.js'
import { assessQuality, runSearch } from '../src/protocol.js'

// ---------- ① 跳转链接解码 ----------

// 真实观测到的 Bing 跳转链接（u=a1<base64url>，解码后为 https://openai.com/）
const CK_OPENAI = 'https://www.bing.com/ck/a?!&&p=e6dbc7ab64233ddffa31805b76dc32d05c6792a8366ec212cd2cd2b5d7e9d6f1JmltdHM9MTc5MTg0OTYwMA&ptn=3&ver=2&hsh=4&fclid=3244b7ca-c851-64e4-10cb-a038c9da657b&u=a1aHR0cHM6Ly9vcGVuYWkuY29tLw&ntb=1'
const CK_GITHUB = 'https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9naXRodWIuY29tL2JnMWF2ZC9jbGF1ZGUtY29kZS1ub2Rl&ntb=1'

test('decodeBingRedirect：ck/a 链接还原为真实 URL', () => {
  assert.equal(decodeBingRedirect(CK_OPENAI), 'https://openai.com/')
  assert.equal(decodeBingRedirect(CK_GITHUB), 'https://github.com/bg1avd/claude-code-node')
})

test('decodeBingRedirect：非跳转链接原样返回', () => {
  assert.equal(decodeBingRedirect('https://example.com/page'), 'https://example.com/page')
  assert.equal(decodeBingRedirect(''), '')
})

test('decodeBingRedirect：无法解码时保留原样（由质量检查兜住）', () => {
  const bad = 'https://www.bing.com/ck/a?u=zzzz-not-base64&ntb=1'
  const out = decodeBingRedirect(bad)
  assert.ok(isBingRedirect(out), '解不出来就保持跳转形态，绝不伪造 URL')
})

test('isDomainRoot：只对域名首页为真', () => {
  assert.equal(isDomainRoot('https://openai.com/'), true)
  assert.equal(isDomainRoot('https://openai.com'), true)
  assert.equal(isDomainRoot('https://openai.com/docs/api'), false)
  assert.equal(isDomainRoot('not a url'), false)
})

// ---------- ② 降级检测 ----------

test('assessQuality：全是域名首页 → degraded', () => {
  const q = assessQuality([
    { url: 'https://openai.com/' }, { url: 'https://chatgpt.com/' }, { url: 'https://en.wikipedia.org/wiki/OpenAI' },
  ])
  // 有 1 条带路径 → 不整体判降级（避免误伤）
  assert.equal(q.degraded, false)
})

test('assessQuality：全部域名首页 → degraded（实测的垃圾形态）', () => {
  const q = assessQuality([
    { url: 'https://openai.com/' }, { url: 'https://chatgpt.com/' }, { url: 'https://platform.openai.com/' },
  ])
  assert.equal(q.degraded, true)
  assert.match(q.reason, /域名首页/)
})

test('assessQuality：含未解码的跳转链接 → degraded', () => {
  const q = assessQuality([{ url: 'https://openai.com/docs' }, { url: CK_OPENAI }])
  assert.equal(q.degraded, true)
  assert.match(q.reason, /跳转链接/)
})

test('assessQuality：空结果不算降级', () => {
  assert.equal(assessQuality([]).degraded, false)
})

test('assessBingQuality 与 assessQuality 判据一致', () => {
  const rows = [{ url: 'https://openai.com/' }, { url: 'https://chatgpt.com/' }]
  assert.equal(assessBingQuality(rows).degraded, assessQuality(rows).degraded)
})

// ---------- parseBing 端到端（含解码） ----------

test('parseBing：解析出的 URL 已是解码后的真实地址', () => {
  const html = `<li class="b_algo"><h2><a href="${CK_GITHUB}">Repo</a></h2><p>desc</p></li>`
  const rows = parseBing(html)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].url, 'https://github.com/bg1avd/claude-code-node')
  assert.equal(rows[0].engine, 'bing')
})

// ---------- ③ runSearch 的降级声明 ----------

/** 构造 fetch 打桩：searxng 失败，bing 返回给定 HTML */
function stubFetch({ bingHtml = '', searxngStatus = 500 } = {}) {
  return async (url) => {
    if (String(url).includes('format=json')) {
      return { ok: false, status: searxngStatus, text: async () => 'err' }
    }
    return { ok: true, status: 200, text: async () => bingHtml }
  }
}

const JUNK_HTML = [
  `<li class="b_algo"><h2><a href="${CK_OPENAI}">OpenAI</a></h2><p>a</p></li>`,
  `<li class="b_algo"><h2><a href="https://chatgpt.com/">ChatGPT</a></h2><p>b</p></li>`,
].join('')

test('runSearch：降级到 bing 时，必须声明"已降级 + 原因"', async () => {
  const out = await runSearch(
    { query: 'x', count: 5 },
    { searxngBase: 'http://127.0.0.1:8809', fetchImpl: stubFetch({ bingHtml: JUNK_HTML }) }
  )
  assert.equal(out.engine, 'bing')
  assert.match(out.text, /已降级到 \*\*bing\*\*/)
  assert.match(out.text, /searxng/, '应说明主后端失败的原因')
})

test('runSearch：降级且结果质量可疑 → 打出质量警告', async () => {
  const out = await runSearch(
    { query: 'x', count: 5 },
    { searxngBase: 'http://127.0.0.1:8809', fetchImpl: stubFetch({ bingHtml: JUNK_HTML }) }
  )
  assert.equal(out.degraded, true)
  assert.match(out.text, /结果质量可疑/)
})

test('runSearch：searxng 正常时不加任何降级/警告前缀', async () => {
  const good = JSON.stringify({ results: [{ title: 'T', url: 'https://a.com/x', content: 'c', engine: 'google cse' }] })
  const fetchImpl = async (url) => {
    if (String(url).includes('format=json')) return { ok: true, status: 200, text: async () => good }
    throw new Error('不应调用 bing')
  }
  const out = await runSearch({ query: 'x', count: 5 }, { searxngBase: 'http://127.0.0.1:8809', fetchImpl })
  assert.equal(out.engine, 'searxng')
  assert.equal(out.degraded, false)
  assert.doesNotMatch(out.text, /降级|可疑/)
})

test('runSearch：noFallback=true 时绝不调用 bing（宁可失败也不给降级结果）', async () => {
  let bingCalled = false
  const fetchImpl = async (url) => {
    if (String(url).includes('format=json')) return { ok: false, status: 500, text: async () => 'err' }
    bingCalled = true
    return { ok: true, status: 200, text: async () => JUNK_HTML }
  }
  const out = await runSearch({ query: 'x', count: 5 }, { searxngBase: 'http://127.0.0.1:8809', noFallback: true, fetchImpl })
  assert.equal(bingCalled, false, 'noFallback 时不得回退到 bing')
  assert.equal(out.isError, true)
  assert.match(out.text, /search unavailable/)
})

test('runSearch：SearXNG 空结果且引擎不可用 → 降级原因里点名是哪些引擎', async () => {
  const emptyWithUnresponsive = JSON.stringify({
    results: [],
    unresponsive_engines: [['brave', 'Suspended: too many requests'], ['duckduckgo', 'CAPTCHA']],
  })
  const fetchImpl = async (url) => {
    if (String(url).includes('format=json')) return { ok: true, status: 200, text: async () => emptyWithUnresponsive }
    return { ok: true, status: 200, text: async () => JUNK_HTML }
  }
  const out = await runSearch({ query: 'x', count: 5 }, { searxngBase: 'http://127.0.0.1:8809', fetchImpl })
  assert.equal(out.engine, 'bing')
  assert.match(out.text, /brave/)
  assert.match(out.text, /duckduckgo/)
  assert.match(out.text, /上游引擎不可用/)
})
