// dsh-whale-ledger · 账本内核（P1）
// 定点金额记账 + 北京日 + 余额观测 + 流水条目 + 账本主人 20% 额度计算。
// 金额一律放大 1e8 为整数运算，避免浮点误差（对齐 whale-widget accounting.mjs 的做法）。
export const ACCOUNTING_VERSION = 1
const SCALE = 100000000

export function moneyUnits(value) {
  const n = Number(value)
  const units = Math.round(n * SCALE)
  if (!Number.isFinite(n) || !Number.isSafeInteger(units)) throw new Error('金额无效或超出可记账范围')
  return units
}
export function preciseMoney(value) { return moneyUnits(value) / SCALE }
export function addMoney(a, b) { return sumMoney([a, b]) }
export function sumMoney(values) {
  let units = 0
  for (const value of values) units += moneyUnits(value)
  if (!Number.isSafeInteger(units)) throw new Error('金额合计超出可记账范围')
  return units / SCALE
}

export function beijingDay(time = Date.now()) {
  const d = new Date(Number(time) + 8 * 3600000)
  if (!Number.isFinite(d.getTime())) throw new Error('无效的观测时间')
  return d.toISOString().slice(0, 10)
}

// 空账本（与余额账本.txt 的口径一致：充值 20% 归账本主人）
export function freshLedger() {
  return {
    version: ACCOUNTING_VERSION,
    createdAt: Date.now(),
    currency: 'CNY',
    entries: [],           // 显式流水：recharge(充值) / spend(花费) / adjust(调整)
    observations: [],      // 余额观测快照（按北京日合并）
    rechargeRefs: [],      // 已记账的充值发票 ID（payment_order_id，去重用）
    fishPercent: 0,        // 本鲸的私房钱分成比例（每次充值金额的 N%，默认 0，可编辑）
  }
}

// 按平台发票记录精确记账充值（P6，主方案）：只记 SUCCESS 且 CNY 的订单，按 payment_order_id 去重。
// 对账规则（v2.7）：发票为新方案第一选择；若存在旧方案（差值检测"自动检测充值"）记下的未对账条目，
// 优先修正该条目的金额为新方案金额（避免双重记账），没有可修正的条目才新增。
// 返回 { added, corrected }。
export function recordRecharges(ledger, paymentOrders) {
  const refs = Array.isArray(ledger.rechargeRefs) ? ledger.rechargeRefs : (ledger.rechargeRefs = [])
  let added = 0
  let corrected = 0
  for (const o of Array.isArray(paymentOrders) ? paymentOrders : []) {
    if (!o || o.payment_order_status !== 'SUCCESS') continue
    if (String(o.currency || 'CNY').toUpperCase() !== 'CNY') continue
    const id = String(o.payment_order_id || '')
    if (!id || refs.includes(id)) continue
    const amount = Number(o.amount)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const paid = String(o.paid_at || '').slice(0, 10)
    const note = '充值（平台发票 · ' + (o.payment_channel || 'unknown') + (paid ? ' · ' + paid : '') + '）'
    const rawPct = Number(ledger.fishPercent)
    const pctNow = Number.isFinite(rawPct) ? Math.min(100, Math.max(0, rawPct)) : 0
    // 找未对账的旧方案条目：优先金额接近的，否则取最旧的一条兜底修正
    const cands = (ledger.entries || []).filter((e) =>
      e.kind === 'recharge' && !e.ref && typeof e.note === 'string' && e.note.indexOf('自动检测充值') === 0)
    let pick = cands.find((e) => Math.abs(e.amountUnits / SCALE - amount) <= Math.max(amount * 0.02, 3))
    if (!pick) pick = cands[0]
    if (pick) {
      if (Math.abs(pick.amountUnits / SCALE - amount) > 0.005) corrected++
      pick.amountUnits = moneyUnits(amount)
      pick.note = note + '［由自动检测修正］'
      pick.ref = id
      pick.pct = pctNow
    } else {
      addEntry(ledger, { kind: 'recharge', owner: 'user', amount, note, ref: id, pct: pctNow })
      added++
    }
    refs.push(id)
  }
  if (refs.length > 500) refs.splice(0, refs.length - 500)
  return { added, corrected }
}

// 添加一条显式流水。kind ∈ recharge|spend|adjust；owner ∈ user|fish（费用归属）；amount > 0 记收入，< 0 记支出（recharge 应为正）。
// ref 为外部对账标识（如平台发票 payment_order_id），供去重与修正。
// pct 为该笔充值发生时适用的私房钱比例（按当次充值计）；缺省时回退 ledger.fishPercent。
export function addEntry(ledger, { kind, owner = 'user', amount = 0, note = '', at = Date.now(), ref = null, pct = null } = {}) {
  const k = String(kind || '')
  if (!['recharge', 'spend', 'adjust'].includes(k)) throw new Error('流水类型无效')
  const o = String(owner || 'user')
  if (o !== 'user' && o !== 'fish') throw new Error('归属无效')
  // spend 一律记成负数：quotaSummary 只把 fish 的负数流水计入「已用」，
  // 传正值会被静默忽略（10-29 踩过：+0.45 记进去了但额度没动）。
  const signedAmount = k === 'spend' ? -Math.abs(Number(amount) || 0) : amount
  const units = moneyUnits(signedAmount)
  const entry = {
    seq: (ledger.entries.reduce((m, e) => Math.max(m, e.seq || 0), 0)) + 1,
    at: Number(at), day: beijingDay(at),
    kind: k, owner: o, amountUnits: units, note: String(note || '').slice(0, 200),
    ref: ref ? String(ref).slice(0, 120) : null,
    pct: (pct == null || !Number.isFinite(Number(pct))) ? null : Number(pct),
  }
  ledger.entries.push(entry)
  if (ledger.entries.length > 10000) ledger.entries.splice(0, ledger.entries.length - 10000)
  return entry
}

// 余额观测：把此刻余额快照并入当日观测（同 whale-widget：当日首测记 opening，差额记 debit/credit）
export function observeBalance(ledger, snapshot) {
  const at = Number(snapshot.at ?? Date.now())
  const day = beijingDay(at)
  const totalUnits = moneyUnits(snapshot.total)
  const rechargeUnits = moneyUnits(snapshot.recharge)
  const bonusUnits = moneyUnits(snapshot.bonus)
  let row = ledger.observations.find((r) => r.day === day)
  if (!row) {
    row = { day, firstAt: at, lastAt: at, openingTotal: totalUnits, openingRecharge: rechargeUnits, openingBonus: bonusUnits, lastTotal: totalUnits, lastRecharge: rechargeUnits, lastBonus: bonusUnits }
    ledger.observations.push(row)
  } else {
    row.lastTotal = totalUnits
    row.lastRecharge = rechargeUnits
    row.lastBonus = bonusUnits
    row.lastAt = at
  }
  if (ledger.observations.length > 400) ledger.observations.splice(0, ledger.observations.length - 400)
  return row
}

// 充值自动检测（P5）：充值钱包只会因充值而上涨（消费只减少它）。
// 用上一次观测的充值余额做基准，当前值更高即视为充值；整数档（50/100/200…）直接取整，
// 非整数则原样返回并标记待核对（可能混入了同步消费）。
export function detectRecharge(ledger, currentRecharge) {
  const rows = ledger.observations
  const prev = rows.length ? rows[rows.length - 1].lastRecharge / SCALE : currentRecharge
  const delta = currentRecharge - prev
  if (!(delta > 0.5)) return null   // <¥0.5 视为浮点/观测噪声，不误报
  const nice = [500, 300, 200, 150, 100, 50, 30, 20, 10]
  for (const n of nice) {
    if (Math.abs(delta - n) <= Math.max(n * 0.02, 1.0)) {
      return { amount: n, snapped: true, needsReview: false }
    }
  }
  return { amount: Number(delta.toFixed(2)), snapped: false, needsReview: true }
}

// 账本主人额度：share = Σ(每笔充值 × 该笔当时比例)，比例缺省回退 ledger.fishPercent（默认 0）。
// used = 归属 fish 的 spend 支出（负数）绝对值合计；
// credits = 归属 fish 的 adjust 合计（正=补贴，负=扣回）；remaining = max(0, share - used + credits)。
export function quotaSummary(ledger) {
  const raw = Number(ledger.fishPercent)
  const curPct = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0
  let recharged = 0
  let share = 0
  let used = 0
  let credits = 0
  for (const e of ledger.entries) {
    const amt = e.amountUnits / SCALE
    if (e.kind === 'recharge' && amt > 0) {
      recharged += amt
      const p = (e.pct != null && Number.isFinite(Number(e.pct))) ? Math.min(100, Math.max(0, Number(e.pct))) : curPct
      share += amt * p / 100
    }
    if (e.owner === 'fish') {
      if (e.kind === 'adjust') credits += amt
      else if (amt < 0) used += -amt
    }
  }
  const allowance = share + credits
  return {
    percent: curPct,
    recharged: preciseMoney(recharged),
    share: preciseMoney(share),
    credits: preciseMoney(credits),
    allowance: preciseMoney(allowance),
    used: preciseMoney(used),
    remaining: preciseMoney(Math.max(0, allowance - used)),
  }
}

// 最近一条观测（给 UI/接口用）
export function lastObservation(ledger) {
  const rows = ledger.observations
  const row = rows[rows.length - 1]
  if (!row) return null
  return {
    day: row.day,
    at: row.lastAt,
    total: row.lastTotal / SCALE,
    recharge: row.lastRecharge / SCALE,
    bonus: row.lastBonus / SCALE,
  }
}
