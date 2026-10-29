// dsh-whale-ledger · P1 账本内核
// 参照活文档 dsh-whale-widget（lib/index.js）的模式：
//   1) apply() 第一件事注册桌面端注入行（webserver/index-inject，宿主启动时一次性收集）
//   2) 其余逻辑放 root.inject(['webServer'], cb) 里等齐服务再跑
//   3) 路由统一走 ctx.webServer.register，返回 disposer
//   4) Web 通道用 ctx.webServer.tapIndex 注入 <script>
//
// P1 提供：
//   GET  /dsh-ledger/status.json  —— 探针
//   GET  /dsh-ledger/balance.json —— 真实余额（宿主 deepseekAccount）+ 账本主人额度
//   GET  /dsh-ledger/entries.json —— 账本流水（只读）
//   POST /dsh-ledger/entries      —— 添加流水（仅本机回环可写）
//   GET  /dsh-ledger/widget.js    —— 角落挂件：显示余额与我的额度
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addEntry, detectRecharge, freshLedger, lastObservation, observeBalance, quotaSummary, recordRecharges } from './accounting.mjs'
import { isPeakTime, nextPeakChangeAt, pricingState, PRICE_TABLE } from './pricing.mjs'
import { addUsage, newTurnAgg } from './turn-tracker.mjs'
import { exportCsv, exportMarkdown } from './export.mjs'

const WIDGET_SRC = '/dsh-ledger/widget.js'
const BUILD_VERSION = '0.10.0-p8'
const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))
let widgetJs = ''
// 2026-10-29：改成每次请求现读，改 widget-client.js 后刷新页面即可，不用重启 DSH
function readWidgetJs() {
  try {
    widgetJs = fs.readFileSync(path.join(PACKAGE_DIR, 'widget-client.js'), 'utf8')
  } catch (err) {
    widgetJs = 'console.error("[whale-ledger] widget-client.js 读取失败: ' + String((err && err.message) || err).slice(0, 120) + '")'
  }
  return widgetJs
}
readWidgetJs()
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const LEDGER_CANDIDATES = [
  path.join(DSH_HOME, 'whale-ledger.json'),
  path.join(DSH_HOME, 'profiles', 'desktop', 'whale-ledger.json'),
]

// 桌面端注入行（内联 script，绝不用 script-src：加载失败会毁掉整个 boot）
const DESKTOP_ROW_TEXT =
  '(function(){try{var d=document;var s=d.createElement("script");s.src="' + WIDGET_SRC + '";' +
  's.onerror=function(){};(d.body||d.documentElement).appendChild(s)}catch(e){}})()'

// —— 账本文件 IO（对齐 whale-widget 的健壮性：坏文件改名备份，不抛错锁死）——
function ledgerPath() {
  for (const p of LEDGER_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p
      const dir = path.dirname(p)
      fs.mkdirSync(dir, { recursive: true })
      return p
    } catch (err) {}
  }
  return LEDGER_CANDIDATES[0]
}
function backupCorrupt(p, why) {
  try {
    const bak = p + '.corrupt-' + Date.now() + '.bak'
    fs.renameSync(p, bak)
    console.error('[whale-ledger] 账本损坏（' + why + '）→ 已备份为 ' + bak + '，并用默认结构重建（原文件未删除）')
  } catch (err) {}
}
function readLedger() {
  const p = ledgerPath()
  let raw = null
  try { raw = fs.readFileSync(p, 'utf8') } catch (err) {
    if (err.code !== 'ENOENT') backupCorrupt(p, 'read-error')
    return freshLedger()
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries) && Array.isArray(parsed.observations)) return parsed
    backupCorrupt(p, 'bad-structure')
  } catch (err) {
    backupCorrupt(p, 'bad-json')
  }
  return freshLedger()
}
function writeLedger(ledger) {
  const p = ledgerPath()
  const tmp = p + '.tmp-' + Date.now()
  fs.writeFileSync(tmp, JSON.stringify(ledger), 'utf8')
  fs.renameSync(tmp, p)
}
let ledger = readLedger()

// —— P6：平台发票接口（精确充值记账）——
let platformToken = ''
function readPlatformToken() {
  if (platformToken) return platformToken
  try {
    const f = fs.readFileSync(path.join(DSH_HOME, '.credentials.yaml'), 'utf8')
    const lines = f.split(/\r?\n/)
    const i = lines.findIndex((l) => l.trim() === 'deepseek-account-platform/default:')
    for (let j = i + 1; j < lines.length && !/^\S/.test(lines[j]); j++) {
      const m = lines[j].match(/^\s*token:\s*(\S+)\s*$/)
      if (m) { platformToken = m[1]; break }
    }
  } catch (err) {}
  return platformToken
}
async function fetchInvoices() {
  const token = readPlatformToken()
  if (!token) return { ok: false, error: '无平台账号 token' }
  try {
    const res = await fetch('https://platform.deepseek.com/auth-api/v0/users/get_all_invoice', {
      method: 'GET',
      redirect: 'error',
      headers: {
        'x-dsh-auth-token': token,
        'x-client-bundle-id': '',
        'x-client-platform': 'desktop-win',
        'x-client-version': String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '44.7.0'),
        'x-client-locale': String(process.env.DSH_LOCALE || '') || 'zh_CN',
        'x-client-timezone-offset': '28800',
      },
    })
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status }
    const payload = await res.json()
    if (payload.code !== 0 || !payload.data || payload.data.biz_code !== 0) return { ok: false, error: '接口业务错误' }
    const bd = payload.data.biz_data
    return { ok: true, orders: (bd && bd.invoices && bd.invoices.payment_orders) || [] }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).slice(0, 120) }
  }
}

// —— P3：轮次花费追踪状态（持久化进账本 JSON 的 turnStats）——
const TURN_COST_WARN = 0.05
const turnAggs = new Map()
const subagentSessions = new Set()
let lastTurn = (ledger.turnStats && ledger.turnStats.lastTurn) || null
let lastTurnSeq = (ledger.turnStats && ledger.turnStats.seq) || 0

export default {
  name: 'dsh-whale-ledger',
  apply(root) {
    const rowDisposers = []
    root.effect(() => () => {
      for (const d of rowDisposers) { try { d() } catch (err) {} }
    })

    // ① 桌面端注入行（必须最先注册，不依赖任何服务）
    rowDisposers.push(root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return
        for (const row of table) {
          if (!row) continue
          if (row.kind === 'script-src' && row.src === WIDGET_SRC) return
          if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(WIDGET_SRC) >= 0) return
        }
        table.push({ kind: 'script', placement: 'body', text: DESKTOP_ROW_TEXT })
      } catch (err) {}
    }))

    // ② 其余逻辑：等 webServer 就绪
    root.inject(['webServer'], (ctx) => {
      const disposers = []
      const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      const JS_HEADERS = { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }

      // 轻量信任校验：非回环/跨站一律拒（读路由同此；对标 whale-widget）
      function rejected(req) {
        try {
          const headers = (req && req.headers) || {}
          let hostUrl = null
          try { hostUrl = new URL('http://' + String(headers.host || '')) } catch (err) { return true }
          const hn = hostUrl.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
          const loopback = hn === 'localhost' || hn.endsWith('.localhost') || hn === '::1'
            || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hn)
          if (!loopback) return true
          const site = String(headers['sec-fetch-site'] || '').toLowerCase()
          if (site === 'cross-site') return true
          return false
        } catch (err) { return true }
      }
      // 写请求必须来自本机回环（对齐 whale-widget v761 安全修复 S1）
      const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
      function writeRejected(req) {
        try {
          const method = String((req && req.method) || 'GET').toUpperCase()
          if (!WRITE_METHODS.has(method)) return false
          return rejected(req)
        } catch (err) { return true }
      }

      function registerRoute(route) {
        const inner = route.handler
        const wrapped = Object.assign({}, route, {
          handler: async (req, res) => {
            if (rejected(req) || writeRejected(req)) { try { res.statusCode = 403; res.end() } catch (err) {} return }
            return inner(req, res)
          },
        })
        const d = ctx.webServer.register(wrapped)
        if (d) disposers.push(d)
        return d
      }
      function json(res, payload) {
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify(payload))
      }

      // —— P3：轮次花费追踪（会话事件流，事件契约对齐 whale-widget 实测）——
      function finalizeTurn(sessionId) {
        const agg = turnAggs.get(sessionId)
        if (!agg) return
        const isSub = subagentSessions.has(String(sessionId || ''))
        lastTurn = { turn: agg.turn, amount: agg.cost, tokens: agg.tokens, ts: agg.lastTs, isSubagent: isSub, byModel: agg.byModel }
        lastTurnSeq++
        try {
          ledger.turnStats = { seq: lastTurnSeq, lastTurn }
          writeLedger(ledger)
        } catch (err) {}
        if (agg.cost >= TURN_COST_WARN) {
          try {
            console.warn('[whale-ledger] ⚠️ 本轮花费 ¥' + agg.cost.toFixed(4) + '（' + agg.tokens + ' tokens'
              + (isSub ? '，子代理' : '') + '）≥ 提醒阈值 ¥' + TURN_COST_WARN.toFixed(2))
          } catch (err) {}
        }
        turnAggs.delete(sessionId)
      }
      function handleSessionEvent(sessionId, event) {
        try {
          const type = event && event.type
          const d = event && event.data
          if (!d || typeof d !== 'object') return
          if (type === 'turn/end') { finalizeTurn(sessionId); return }
          if (type !== 'assistant/message') return
          const turn = Number(d.turn)
          const usage = d.usage
          if (!usage || typeof usage !== 'object' || !isFinite(turn)) return
          let agg = turnAggs.get(sessionId)
          if (!agg || agg.turn !== turn) {
            if (agg) finalizeTurn(sessionId)
            agg = newTurnAgg(turn)
            turnAggs.set(sessionId, agg)
          }
          const model = d.message && d.message.source ? d.message.source.model : ''
          addUsage(agg, usage, model)
        } catch (err) {}
      }
      try {
        disposers.push(ctx.on('subagent/start', (info) => { const id = info && info.id ? String(info.id) : ''; if (id) subagentSessions.add(id) }))
        disposers.push(ctx.on('subagent/end', (info) => { const id = info && info.id ? String(info.id) : ''; if (id) subagentSessions.add(id) }))
        disposers.push(ctx.on('session/event', (session, event) => {
          const sid = session && session.id ? session.id : 'default'
          handleSessionEvent(sid, event)
        }))
        disposers.push(ctx.on('session/disposed', (session) => { if (session && session.id) turnAggs.delete(session.id) }))
      } catch (err) {}

      // —— P3：谷价窗口日志（ctx.schedule 形状未验证 → 降级；pricing.json 已带下切点）——
      try {
        const nowSec = Math.floor(Date.now() / 1000)
        const segs = [(isPeakTime(nowSec) ? '高峰' : '谷价') + ' 中']
        let cur = nowSec
        for (let i = 0; i < 3; i++) {
          const next = nextPeakChangeAt(cur)
          if (next == null) break
          const bj = new Date(next * 1000 + 8 * 3600 * 1000)
          segs.push(String(bj.getUTCHours()).padStart(2, '0') + ':00 转' + (isPeakTime(next) ? '高峰' : '谷价'))
          cur = next + 1
        }
        console.log('[whale-ledger] 今日峰谷窗口：' + segs.join(' → '))
      } catch (err) {}

      // —— 真实余额查询（宿主 deepseekAccount，与 whale-widget 同口径）——
      async function fetchBalance() {
        let account = null
        try { account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : null } catch (err) { account = null }
        if (!account || typeof account.getBalance !== 'function') return { ok: false, error: '宿主账号服务不可用' }
        let result
        try {
          result = await account.getBalance({
            version: String(process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '') || 'unknown',
            locale: String(process.env.DSH_LOCALE || '') || 'zh_CN',
            timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
          })
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err).slice(0, 160) }
        }
        if (!result) return { ok: false, error: '未登录 DeepSeek 账号（没有账号凭据）' }
        if (result.status !== 'ready') return { ok: false, error: '账号余额接口未就绪（' + String(result.status || 'unknown') + '）' }
        const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
        const norm = Array.isArray(result.value) ? result.value.filter((w) => w && num(w.balance) !== null) : []
        const bonus = Array.isArray(result.bonusWallets) ? result.bonusWallets.filter((w) => w && num(w.balance) !== null) : []
        const all = norm.concat(bonus)
        if (!all.length) return { ok: false, error: '账号没有余额钱包' }
        const curOf = (w) => String((w && w.currency) || 'CNY').toUpperCase()
        const nonzero = all.filter((w) => num(w.balance) > 0)
        const cur = ((nonzero.find((w) => curOf(w) === 'CNY') || nonzero[0] || all[0]) && curOf(nonzero.find((w) => curOf(w) === 'CNY') || nonzero[0] || all[0])) || 'CNY'
        const sumOf = (list) => list.filter((w) => curOf(w) === cur).reduce((s, w) => s + num(w.balance), 0)
        const recharge = sumOf(norm)
        const bonusSum = sumOf(bonus)
        return { ok: true, currency: cur, recharge, bonus: bonusSum, total: Number((recharge + bonusSum).toFixed(6)) }
      }

      // 探针路由
      registerRoute({
        kind: 'exact',
        path: '/dsh-ledger/status.json',
        handler: async (req, res) => {
          json(res, {
            ok: true, name: 'dsh-whale-ledger', version: BUILD_VERSION,
            time: new Date().toISOString(),
            ledger: { entries: ledger.entries.length, observations: ledger.observations.length },
            quota: quotaSummary(ledger),
          })
        },
      })

      // 余额 + 额度（真实余额，并记一次观测）
      registerRoute({
        kind: 'exact',
        path: '/dsh-ledger/balance.json',
        handler: async (req, res) => {
          const refresh = new URL(req.url || '/', 'http://localhost').searchParams.get('refresh') === '1'
          if (refresh) ledger = readLedger()
          const balance = await fetchBalance()
          if (balance.ok) {
            // P6：优先走平台发票接口（精确、只记 SUCCESS、按订单 ID 去重）；
            // 接口失败时回退 P5 差值检测（整数档取整）。
            const inv = await fetchInvoices()
            if (inv.ok) {
              const r = recordRecharges(ledger, inv.orders)
              if (r.added > 0 || r.corrected > 0) {
                try { console.log('[whale-ledger] 发票对账：新增 ' + r.added + ' 笔，修正 ' + r.corrected + ' 笔（新方案为准）') } catch (err) {}
              }
            } else {
              const det = detectRecharge(ledger, balance.recharge)
              if (det) {
                const rawP = Number(ledger.fishPercent)
                const pctNow = Number.isFinite(rawP) ? Math.min(100, Math.max(0, rawP)) : 0
                addEntry(ledger, {
                  kind: 'recharge', owner: 'user', amount: det.amount,
                  note: det.snapped ? '自动检测充值' : '自动检测充值（待核对）',
                  pct: pctNow,
                })
              }
            }
            observeBalance(ledger, { at: Date.now(), total: balance.total, recharge: balance.recharge, bonus: balance.bonus })
            try { writeLedger(ledger) } catch (err) {}
          }
          json(res, {
            ok: balance.ok,
            balance: balance.ok ? { currency: balance.currency, recharge: balance.recharge, bonus: balance.bonus, total: balance.total } : null,
            error: balance.ok ? '' : balance.error,
            quota: quotaSummary(ledger),
            lastObservation: lastObservation(ledger),
            version: BUILD_VERSION,
          })
        },
      })

      // 账本流水（只读）
      registerRoute({
        kind: 'exact',
        path: '/dsh-ledger/entries.json',
        handler: async (req, res) => {
          if (new URL(req.url || '/', 'http://localhost').searchParams.get('refresh') === '1') ledger = readLedger()
          json(res, { ok: true, quota: quotaSummary(ledger), entries: ledger.entries.slice(-500), observations: ledger.observations.slice(-60) })
        },
      })

      // 修改私房钱分成比例（仅本机回环 POST，0-100）
      registerRoute({
        kind: 'exact',
        path: '/dsh-ledger/percent',
        handler: async (req, res) => {
          if (String((req && req.method) || '').toUpperCase() !== 'POST') { res.statusCode = 405; res.end(); return }
          let body = ''
          try {
            for await (const chunk of req) {
              body += String(chunk)
              if (body.length > 256) throw new Error('body too large')
            }
            const input = JSON.parse(body || '{}')
            const v = Number(input.percent)
            if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('比例须为 0-100 的数字')
            ledger = readLedger()
            ledger.fishPercent = v
            writeLedger(ledger)
            json(res, { ok: true, quota: quotaSummary(ledger) })
          } catch (err) {
            json(res, { ok: false, error: String((err && err.message) || err).slice(0, 200) })
          }
        },
      })

      // 添加流水（仅本机回环 POST）
      registerRoute({
        kind: 'exact',
        path: '/dsh-ledger/entries',
        handler: async (req, res) => {
          if (String((req && req.method) || '').toUpperCase() !== 'POST') { res.statusCode = 405; res.end(); return }
          let body = ''
          try {
            for await (const chunk of req) {
              body += String(chunk)
              if (body.length > 4096) throw new Error('body too large')
            }
            const input = JSON.parse(body || '{}')
            ledger = readLedger()
            const entry = addEntry(ledger, {
              kind: input.kind, owner: input.owner, amount: input.amount, note: input.note, at: Date.now(),
            })
            writeLedger(ledger)
            json(res, { ok: true, entry, quota: quotaSummary(ledger) })
          } catch (err) {
            json(res, { ok: false, error: String((err && err.message) || err).slice(0, 200) })
          }
        },
      })

      // 账本导出（P4）：md / csv / json，附件下载
      registerRoute({
        kind: 'exact',
        path: '/dsh-ledger/export',
        handler: async (req, res) => {
          try {
            const format = new URL(req.url || '/', 'http://localhost').searchParams.get('format') || 'md'
            let body = ''
            let type = ''
            let name = ''
            if (format === 'md') {
              body = exportMarkdown(ledger); type = 'text/markdown; charset=utf-8'; name = 'whale-ledger.md'
            } else if (format === 'csv') {
              body = '\ufeff' + exportCsv(ledger); type = 'text/csv; charset=utf-8'; name = 'whale-ledger.csv'
            } else if (format === 'json') {
              body = JSON.stringify(ledger, null, 2); type = 'application/json; charset=utf-8'; name = 'whale-ledger.json'
            } else {
              res.statusCode = 400
              res.end('invalid format: ' + format)
              return
            }
            res.writeHead(200, {
              'Content-Type': type,
              'Content-Disposition': 'attachment; filename="' + name + '"',
              'Cache-Control': 'no-store',
            })
            res.end(body)
          } catch (err) {
            res.statusCode = 500
            res.end('export failed')
          }
        },
      })

      // 最近一轮花费（P3）
      registerRoute({
        kind: 'exact',
        path: '/dsh-ledger/last-turn.json',
        handler: async (req, res) => {
          json(res, { ok: true, seq: lastTurnSeq, lastTurn, version: BUILD_VERSION })
        },
      })

      // 平台发票明细（P6，只读透传：充值订单 + 状态）
      registerRoute({
        kind: 'exact',
        path: '/dsh-ledger/invoices.json',
        handler: async (req, res) => {
          const inv = await fetchInvoices()
          json(res, { ok: inv.ok, error: inv.ok ? '' : inv.error, orders: inv.ok ? inv.orders : [] })
        },
      })

      // 峰谷时段（与 whale-widget 同口径）
      registerRoute({
        kind: 'exact',
        path: '/dsh-ledger/pricing.json',
        handler: async (req, res) => {
          json(res, { ok: true, ...pricingState(), prices: PRICE_TABLE, version: BUILD_VERSION })
        },
      })

      // 角落挂件：下发客户端脚本（lib/widget-client.js）
      registerRoute({
        kind: 'exact',
        path: WIDGET_SRC,
        handler: async (req, res) => {
          res.writeHead(200, JS_HEADERS)
          res.end(readWidgetJs())
        },
      })

      // Web 形态注入通道
      disposers.push(ctx.webServer.tapIndex((html) => {
        if (typeof html !== 'string' || html.indexOf(WIDGET_SRC) !== -1) return html
        const tag = '<script defer src="' + WIDGET_SRC + '"></script>'
        if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>')
        return html + tag
      }))

      ctx.effect(() => () => {
        for (const d of disposers) { try { d() } catch (err) {} }
      })

      try {
        console.log('[whale-ledger] P3 已加载：balance/entries/last-turn/pricing/widget 路由 + 轮次花费追踪（阈值 ¥' + TURN_COST_WARN.toFixed(2) + '）')
      } catch (err) {}
    })
  },
}
