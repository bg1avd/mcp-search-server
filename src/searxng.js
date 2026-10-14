/**
 * SearXNG JSON 搜索客户端（零依赖）
 *
 * 方案 A 的后端接入：调用用户自建的 SearXNG 实例（走其 /search?format=json）。
 * SearXNG 在服务端负责把查询调度给 google-cse / brave / bing / startpage 等上游引擎，
 * mcp-search-server 只转发其结果，因而规避"我方数据中心 IP 被 DDG 验证码拦截"的问题。
 *
 * 上游由 SearXNG 配置决定（默认 google cse / brave 即足够）。
 * 用法：
 *   MCP 搜索服务器 SERVER_URL=...  ; 若部署了 SearXNG，设 SEARXNG_URL=http://127.0.0.1:8809
 *   search 工具会自动请求  <SEARXNG_URL>/search?q=...&format=json&language=...
 */

const DDG_JSON_TIMEOUT = 20000

/**
 * 构造 SearXNG JSON 查询 URL
 * @param {string} base    SearXNG 根，例如 http://127.0.0.1:8809
 * @param {object} opts    {query,count,region?}
 */
export function buildSearxUrl(base, opts) {
  const q = (opts.query || '').trim()
  const url = new URL('/search', base)
  url.searchParams.set('q', q)
  url.searchParams.set('format', 'json')
  url.searchParams.set('safesearch', '0')
  // 大致让引擎更偏该语言/地域
  if (opts.region) url.searchParams.set('language', String(opts.region))
  return url
}

/**
 * 请求 SearXNG JSON 并规整为用户 /search 需要的结果数组。
 * @param {object} param
 * @param {string} param.base       SearXNG 根
 * @param {string} param.query
 * @param {number} [param.count]
 * @param {string} [param.region]
 * @param {Function}[param.fetchImpl]
 * @returns {Promise<Array<{title,url,snippet,engine}>>}
 * @throws SearXNG 不可达 / 非 JSON 时抛错
 */
export async function searxngSearch({ base, query, count = 10, region = '', fetchImpl = globalThis.fetch }) {
  if (!base || !/^https?:\/\//.test(base)) {
    throw new Error('SEARXNG_URL 未配置或不合法（示例 http://127.0.0.1:8809）')
  }
  if (!query || !query.trim()) return []
  const url = buildSearxUrl(base, { query, count, region })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DDG_JSON_TIMEOUT)
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { 'User-Agent': 'mcp-search-server', Accept: 'application/json' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok) {
      // SearXNG 可能因 bot detection 返回 429 / 202 / 403
      if (res.status === 429 || res.status === 403 || res.status === 202) {
        throw new Error(`SearXNG ${res.status}（可能是反爬/限频，稍后再试）`)
      }
      throw new Error(`SearXNG HTTP ${res.status}`)
    }
    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('SearXNG 未返回 JSON（可能需开启 search.formats 含 json，或需 JS/anti-bot）')
    }
    const results = data.results || []
    // 规整：保留 title/url/snippet 与引擎名；去掉引擎重复不必要。
    // v0.1.3：把 SearXNG 上报的 unresponsive_engines 挂在返回数组上
    // （数组属性，不影响 length/map 等常规用法）。上层在"空结果"时用它解释原因：
    // 实测长这样 —— [["brave","Suspended: too many requests"],["duckduckgo","CAPTCHA"]]
    const rows = results.slice(0, count > 0 ? count : undefined).map((r) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: (r.content || '') /* searx 用 content 作摘要 */,
      engine: r.engine || '',
    }))
    rows.unresponsive = (data.unresponsive_engines || []).map((e) => (Array.isArray(e) ? `${e[0]}(${e[1]})` : String(e)))
    return rows
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 在当前环境判断是否配置了 SearXNG 后端。若没配或连不上，可给出原因。
 * 为了让 users 快速上手，mcp-search-server 的 search 工具会把"我是否配了 SEARXNG"
 * 作为一次探测信息写进返回（对排错友好）。
 * @param {object} ctx { base, fetchImpl }
 */
export async function probeSearx({ base, fetchImpl = globalThis.fetch } = {}) {
  if (!base) return { ok: false, reason: 'no SEARXNG_URL' }
  try {
    const r = await fetchImpl(base + '/search?q=poke&format=json', {
      method: 'GET', headers: { Accept: 'application/json' },
    })
    return { ok: r.ok, status: r.status }
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e) }
  }
}
