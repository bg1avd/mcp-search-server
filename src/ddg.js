/**
 * DuckDuckGo HTML 搜索引擎（零依赖）
 *
 * 抓取 html.duckduckgo.com 结果页并解析，无需任何付费 API Key。
 *
 * 注意：DuckDuckGo 会针对高频/可疑来源返回反爬验证页（HTTP 202 + anomaly）。
 * 个人/低频使用稳定；商用/极高频率请叠加如下游多引擎或官方 API。
 * 解析器对"验证页"与"真无结果"做了区分，见 isDdgChallenge()。
 */

const DDG_HTML = 'https://html.duckduckgo.com/html/'
const UA =
  'Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0'

/** HTML 实体 + 标签 → 纯文本 */
function stripTags(raw) {
  if (!raw) return ''
  let s = raw.replace(/<[^>]*>/g, ' ')
  s = s.replace(/&#(x)?([0-9a-f]+);/gi, (_, hex, code) => {
    try {
      const n = hex ? parseInt(code, 16) : parseInt(code, 10)
      return String.fromCodePoint(n)
    } catch {
      return ''
    }
  })
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', hellip: '…', lsquo: '\u2018', rsquo: '\u2019',
    ldquo: '\u201C', rdquo: '\u201D',
  }
  s = s.replace(/&([a-z]+);/gi, (m, n) => (n in named ? named[n] : ''))
  return s.replace(/\s+/g, ' ').trim()
}

/** 从 DDG 跳转链接还原真实 URL（uddg 参数） */
function resolveTargetUrl(href) {
  if (!href) return ''
  let out = href
  const m = /[?&]uddg=([^&]+)/.exec(href)
  if (m && m[1]) {
    try {
      out = decodeURIComponent(m[1])
    } catch {
      out = href
    }
  }
  if (out.startsWith('//')) out = 'https:' + out
  return out
}

/**
 * 解析结果页。返回 [{title, url, snippet}]，自动去重。
 * @param {string} html
 */
export function parseResults(html) {
  if (!html) return []
  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  const snipRe = /<a[^>]*class="result__snippet"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi

  const titles = []
  let m
  while ((m = titleRe.exec(html)) !== null) {
    titles.push({ url: resolveTargetUrl(m[1]), title: stripTags(m[2]) })
  }
  const snippets = []
  while ((m = snipRe.exec(html)) !== null) snippets.push(stripTags(m[2]))

  const results = []
  const seen = new Set()
  titles.forEach((t, i) => {
    if (!t.title || !t.url) return
    if (seen.has(t.url)) return
    seen.add(t.url)
    results.push({ title: t.title, url: t.url, snippet: snippets[i] || '' })
  })
  return results
}

/**
 * 判断响应页是否为 DDG 反爬/验证页。
 * @param {string} html
 */
export function isDdgChallenge(html) {
  if (!html) return false
  const lower = html.slice(0, 20000).toLowerCase()
  const markers = [
    'anomaly',
    'id="challenge"',
    'dangerouslysettinginnerhtml',
    'no result is present in the given source',
  ]
  return markers.some((mk) => lower.includes(mk))
}

/**
 * 执行一次搜索。
 * @param {object} opts
 * @param {string} opts.query
 * @param {number} [opts.count=10]
 * @param {string} [opts.region]
 * @param {number} [opts.timeout=16000]
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<Array<{title:string,url:string,snippet:string}>>}
 * @throws 被反爬/网络故障时抛错
 */
export async function duckduckgoSearch(opts) {
  const { query, count = 10, region = '', timeout = 16000, fetchImpl = globalThis.fetch } = opts
  if (!query || !query.trim()) return []

  const body = new URLSearchParams()
  body.set('q', query.trim())
  if (region) body.set('kl', region)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetchImpl(DDG_HTML, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
      },
      body: body.toString(),
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok && res.status !== 202) throw new Error(`DuckDuckGo HTTP ${res.status}`)
    const html = await res.text()
    // 反爬验证页：明确报错
    if (isDdgChallenge(html) || res.status === 202) {
      throw new Error('DuckDuckGo 反爬限流：请降低请求频率或稍后再试')
    }
    let results = parseResults(html)
    if (count > 0) results = results.slice(0, count)
    return results
  } finally {
    clearTimeout(timer)
  }
}
