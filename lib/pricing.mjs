// dsh-whale-ledger · 峰谷定价模块（P2）
// 口径与活文档 dsh-whale-widget 完全一致（官方 2026-09-19 说明）：
//   高峰 = 北京时间周一至周五 9:00–12:00、14:00–18:00（不含中国法定节假日）
//   其余时段（含周末、调休上班的周末、法定节假日全天）按谷价（半价）。
export const PEAK_HOURS = [
  [9, 12],
  [14, 18],
]

// 价格表：元 / 百万 token，[谷价, 高峰价]（来源 api-docs.deepseek.com/zh-cn/quick_start/pricing）
export const PRICE_TABLE = {
  'deepseek-flash': { label: 'deepseek-flash (V4.1)', hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  'deepseek-v4-pro': { label: 'deepseek-v4-pro', hit: [0.15, 0.3], miss: [4.5, 9.0], out: [13.5, 27.0] },
}

const WEEKEND_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000) // 北京时间 2026-08-23 00:00
const HOLIDAY_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 8, 18, 16, 0, 0) / 1000) // 北京时间 2026-09-19 00:00

// 2026 年法定节假日（依据国办发明电〔2025〕7 号；调休上班日全在周末，本就谷价，无需单列）
const HOLIDAY_VALLEY = {
  '2026-01-01': 1, '2026-01-02': 1, '2026-01-03': 1,
  '2026-02-15': 1, '2026-02-16': 1, '2026-02-17': 1, '2026-02-18': 1, '2026-02-19': 1,
  '2026-02-20': 1, '2026-02-21': 1, '2026-02-22': 1, '2026-02-23': 1,
  '2026-04-04': 1, '2026-04-05': 1, '2026-04-06': 1,
  '2026-05-01': 1, '2026-05-02': 1, '2026-05-03': 1, '2026-05-04': 1, '2026-05-05': 1,
  '2026-06-19': 1, '2026-06-20': 1, '2026-06-21': 1,
  '2026-09-25': 1, '2026-09-26': 1, '2026-09-27': 1,
  '2026-10-01': 1, '2026-10-02': 1, '2026-10-03': 1, '2026-10-04': 1,
  '2026-10-05': 1, '2026-10-06': 1, '2026-10-07': 1,
}

function isHolidayValley(bjDate) {
  try {
    return !!HOLIDAY_VALLEY[bjDate.toISOString().slice(0, 10)]
  } catch (err) { return false }
}

export function isPeakTime(timeSec) {
  if (!isFinite(Number(timeSec))) return false
  const n = Number(timeSec)
  const bj = new Date(n * 1000 + 8 * 3600 * 1000)
  if (n >= WEEKEND_VALLEY_FROM_SEC) {
    const dow = bj.getUTCDay()
    if (dow === 0 || dow === 6) return false
  }
  if (n >= HOLIDAY_VALLEY_FROM_SEC && isHolidayValley(bj)) return false
  const hour = bj.getUTCHours()
  for (const [start, end] of PEAK_HOURS) {
    if (hour >= start && hour < end) return true
  }
  return false
}

// 下一个峰谷切换时刻（epoch 秒）；与 isPeakTime 同源。12 天内找不到返回 null（当前规则下不会发生）。
export function nextPeakChangeAt(timeSec) {
  const n = Number(timeSec)
  if (!isFinite(n)) return null
  const cur = isPeakTime(n)
  const day0 = Math.floor((n + 8 * 3600) / 86400) * 86400
  for (let d = 0; d <= 12; d++) {
    for (const edge of [0, 9, 12, 14, 18]) {
      const cand = day0 + d * 86400 + edge * 3600 - 8 * 3600
      if (cand <= n + 1) continue
      if (isPeakTime(cand) !== cur) return cand
    }
  }
  return null
}

// 当前时段状态（供接口与前端倒计时）
export function pricingState(nowMs = Date.now()) {
  const sec = Math.floor(nowMs / 1000)
  const isPeak = isPeakTime(sec)
  const nextAt = nextPeakChangeAt(sec)
  return {
    isPeak,
    label: isPeak ? '高峰价' : '谷价 · 半价',
    multiplier: isPeak ? 2 : 1,
    nextChangeAt: nextAt ? nextAt * 1000 : null,
    nextLabel: nextAt ? (isPeakTime(nextAt) ? '将进入高峰价' : '将进入谷价') : null,
  }
}
