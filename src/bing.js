/**
 * Bing 网页版搜索（零依赖，尽力而为的轻量兜底后端）
 *
 * 用于"未配置 SearXNG"或 SearXNG 临时全引擎失败时的兜底。注意：
 *  - 数据中心/被风控 IP 上 Bing 会返回**降级结果**（常表现为品牌首页：openai.com、
 *    chatgpt.com…），准确性很差；
 *  - 推荐生产主力是 searxng（服务器侧聚合 google-cse/brave/bing 等多个源）。
 *
 * ## v0.1.3 的两个修复
 *
 * ① **解码 `bing.com/ck/a` 跳转链接**
 *    Bing 的结果 URL 常是 `https://www.bing.com/ck/a?!&&p=…&u=a1<base64url>&ntb=1`，
 *    其中 `u=a1<base64url>` 编码了真实 URL。不解码 → 下游拿到的是一串
 *    `bing.com/ck/a?...` 噪声，既不能引用也不能二次抓取。
 *
 * ② **降级检测（degraded）**
 *    实测：被标记 IP 上 Bing 会返回"品牌首页集合"（所有 URL 都是域名根路径），
 *    看起来像结果、实际无信息量。本模块把它显式标记出来，
 *    由 protocol.js 决定"是否如实告知用户"，而不是把垃圾当正常结果端上去。
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
 * 解码 Bing 的跳转链接 `…/ck/a?…&u=a1<base64url>&…`，取出真实 URL。
 * 解不出来（格式变化/未编码）时**原样返回**，由 isBingRedirect() 判定为不可用。
 * @param {string} url
 * @returns {string}
 */
export function decodeBingRedirect(url) {
  if (!url || !/bing\.com\/ck\/a/i.test(url)) return url
  try {
    const u = new URL(url).searchParams.get('u')
    if (!u) return url
    // 形如 a1aHR0cHM6Ly8… —— 前缀 a1 表示"绝对 URL + base64url"
    let b64 = u
    if (b64.startsWith('a1')) b64 = b64.slice(2)
    const decoded = Buffer.from(b64, 'base64url').toString('utf-8')
    if (/^https?:\/\//i.test(decoded)) return decoded
  } catch { /* 解码失败 → 保留原样 */ }
  return url
}

/** 是否仍是无法还原的 Bing 跳转链接 */
export function isBingRedirect(url) {
  return /bing\.com\/ck\/a/i.test(String(url || ''))
}

/** 判断 URL 是否"只是域名首页"（path 为空或 '/'）—— 降级结果集的典型特征 */
export function isDomainRoot(url) {
  try {
    const u = new URL(url)
    return u.pathname === '/' || u.pathname === ''
  } catch { return false }
}

/**
 * 结果集质量评估 —— 用于识别"看着像结果、其实没信息量"的降级集。
 *
 * 判据（保守，避免误伤正常搜索）：
 *   · 存在无法解码的 Bing 跳转链接 → 下游无法使用，直接判定 degraded
 *   · **全部**结果都是域名根路径（正常搜索几乎不会全是首页）→ degraded
 *
 * @param {Array<{title:string,url:string,snippet:string}>} rows
 * @returns {{degraded:boolean, reason:string, redirects:number, roots:number}}
 */
export function assessBingQuality(rows = []) {
  const total = rows.length
  if (!total) return { degraded: false, reason: '', redirects: 0, roots: 0 }
  const redirects = rows.filter((r) => isBingRedirect(r.url)).length
  const roots = rows.filter((r) => isDomainRoot(r.url)).length
  if (redirects > 0) {
    return { degraded: true, reason: `有 ${redirects}/${total} 条仍是无法还原的 Bing 跳转链接`, redirects, roots }
  }
  if (roots === total) {
    return { degraded: true, reason: `全部 ${total} 条都是域名首页（无具体页面），典型的降级结果`, redirects, roots }
  }
  return { degraded: false, reason: '', redirects, roots }
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
    // v0.1.3：先解码 ck/a 跳转，拿到真实 URL；解不出则保留原样（上层会判 degraded）
    let url = decodeBingRedirect(stripTags(hrefM[1]))
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
