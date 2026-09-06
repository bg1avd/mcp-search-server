/**
 * Bing 网页版搜索（零依赖，尽力而为的轻量兜底后端）
 *
 * 用于"未配置 SearXNG"时的默认 fallback。注意：
 *  - 数据中心/被风控 IP 上 Bing 可能返回弱相关降级结果，实测准确性不稳定；
 *  - 推荐生产主力是 backend:searxng（服务器侧聚合 google-cse/brave/bing 等多个源）。
 * 这里仅封装 HTML 抓取 + 解析，让 search 在后端规划里多一手备用。
 */

const BING = 'https://www.bing.com/search'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function stripTags(raw) {
  if (!raw) return ''
  let s = raw.replace(/<[^>]*>/g, ' ')
  s = s.replace(/&#(x)?([0-9a-f]+);/gi, (_, hex, code) => {
    try { return String.fromCodePoint(hex ? parseInt(code, 16) : parseInt(code, 10)) } catch { return '' }
  })
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  s = s.replace(/&([a-z]+);/gi, (m, n) => (n in named ? named[n] : ''))
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * 解析 Bing 结果页的 b_algo 块。
 * @param {string} html
 */
export function parseBing(html) {
  if (!html) return []
  // <li class="b_algo"> ... <h2><a href="URL">Title</a> ... <p>snippet</p>
  const blocks = html.split(/<li class="b_algo"/).slice(1)
  const out = []
  for (const b of blocks) {
    const hrefM = b.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    const pM = b.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    if (!hrefM) continue
    let url = stripTags(hrefM[1])
    // Bing 常见 bing.com/ck/a 跳转，无法还原真实 URL 时保留原样
    const title = stripTags(hrefM[2])
    const snippet = pM ? stripTags(pM[1]) : ''
    if (url && title) out.push({ title, url, snippet, engine: 'bing' })
  }
  // 去重
  const seen = new Set()
  return out.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)))
}

/**
 * 搜 Bing。
 * @param {object} opts {query, count, fetchImpl}
 * @returns {Promise<Array>}
 */
export async function bingSearch({ query, count = 10, fetchImpl = globalThis.fetch }) {
  if (!query || !query.trim()) return []
  const qs = new URLSearchParams({ q: query.trim() }).toString()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 16000)
  try {
    const res = await fetchImpl(`${BING}?${qs}`, {
      method: 'GET',
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Bing HTTP ${res.status}`)
    const html = await res.text()
    let rows = parseBing(html)
    if (count > 0) rows = rows.slice(0, count)
    return rows
  } finally {
    clearTimeout(timer)
  }
}
