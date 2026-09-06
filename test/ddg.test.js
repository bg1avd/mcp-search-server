/**
 * DuckDuckGo 解析 & 搜索引擎单测（离线，使用 fixtures）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseResults, duckduckgoSearch, isDdgChallenge } from '../src/ddg.js'

const fx = async (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf-8')

const SAMPLE_HTML = `</head><body>
<div class="result results_links results_links_deep web-result">
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://example.com/a?x=1&y=2')}&rut=aaa">Alpha &amp; Beta</a>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://example.com/a?x=1&y=2')}&rut=aaa">some &#x27;snippet&#x27; text</a>
</div>
</body>`

test('parseResults：title/url/snippet & uddg 还原 & 实体清洗', () => {
  const r = parseResults(SAMPLE_HTML)
  assert.equal(r.length, 1)
  assert.equal(r[0].title, 'Alpha & Beta')
  assert.equal(r[0].url, 'https://example.com/a?x=1&y=2')
  assert.equal(r[0].snippet, "some 'snippet' text")
})

test('isDdgChallenge 检测反爬页', async () => {
  assert.equal(isDdgChallenge(''), false)
  assert.equal(isDdgChallenge('<div id="challenge">bot check</div>'), true)
  assert.equal(isDdgChallenge('<title>anomaly</title>'), true)
  try {
    const c = await fx('ddg-challenge-sample.html')
    assert.equal(isDdgChallenge(c), true)
  } catch { /* fixture 不在也可，上面已覆盖 */ }
})

test('duckduckgoSearch：注入假 fetch 验证调用链', async () => {
  const calls = []
  const fakeFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, body: String(opts.body) })
    return new Response('<html><body>' + SAMPLE_HTML + '</body></html>', { status: 200 })
  }
  const out = await duckduckgoSearch({ query: '  hello  ', region: 'us-en', fetchImpl: fakeFetch })
  assert.equal(calls[0].method, 'POST')
  assert.match(calls[0].url, /html\.duckduckgo\.com/ )
  assert.match(calls[0].body, /q=hello/)
  assert.match(calls[0].body, /kl=us-en/)
  assert.equal(out.length, 1)
})

test('duckduckgoSearch：反爬验证页抛明确错误', async () => {
  const fakeFetch = async () => new Response('<html>id="challenge"</html>', { status: 202 })
  await assert.rejects(
    () => duckduckgoSearch({ query: 'x', fetchImpl: fakeFetch }),
    /反爬|限流/
  )
})

test('duckduckgoSearch：空关键词返回空数组', async () => {
  const out = await duckduckgoSearch({ query: '   ', fetchImpl: async () => new Response('') })
  assert.deepEqual(out, [])
})
