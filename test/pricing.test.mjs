// 峰谷定价模块单元测试（node test/pricing.test.mjs）
import assert from 'node:assert'
import { isPeakTime, nextPeakChangeAt, pricingState } from '../lib/pricing.mjs'

const sec = (iso) => Math.floor(Date.parse(iso) / 1000)
const bj = (h, m, s) => sec('2026-10-19T' + (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s) + '+08:00') // 2026-10-19 周一

// 工作日高峰/谷价边界
assert.strictEqual(isPeakTime(bj(9, 0, 0)), true, '周一 09:00 高峰')
assert.strictEqual(isPeakTime(bj(10, 0, 0)), true, '周一 10:00 高峰')
assert.strictEqual(isPeakTime(bj(8, 59, 59)), false, '周一 08:59 谷价')
assert.strictEqual(isPeakTime(bj(12, 0, 0)), false, '周一 12:00 谷价（午休）')
assert.strictEqual(isPeakTime(bj(13, 59, 59)), false, '周一 13:59 谷价')
assert.strictEqual(isPeakTime(bj(14, 0, 0)), true, '周一 14:00 高峰')
assert.strictEqual(isPeakTime(bj(18, 0, 0)), false, '周一 18:00 谷价')

// 周末全天谷价
assert.strictEqual(isPeakTime(sec('2026-10-18T10:00:00+08:00')), false, '周日全天谷价')
assert.strictEqual(isPeakTime(sec('2026-10-17T15:00:00+08:00')), false, '周六全天谷价')

// 法定节假日全天谷价（规则自 2026-09-19 生效，仅断言生效日之后的节假日）
assert.strictEqual(isPeakTime(sec('2026-10-01T10:00:00+08:00')), false, '国庆（周四，10/1）谷价')
assert.strictEqual(isPeakTime(sec('2026-09-25T10:00:00+08:00')), false, '中秋（周五，9/25）谷价')
assert.strictEqual(isPeakTime(sec('2026-09-27T10:00:00+08:00')), false, '中秋（周日，9/27）谷价')
// 生效日之前的历史节假日按旧规则（工作日仍高峰）——与 whale-widget 口径一致
assert.strictEqual(isPeakTime(sec('2026-01-01T10:00:00+08:00')), true, '2026 元旦在规则生效前，按旧规则高峰')

// 下一个切换点
assert.strictEqual(nextPeakChangeAt(bj(8, 0, 0)), bj(9, 0, 0), '周一 08:00 → 09:00 进峰')
assert.strictEqual(nextPeakChangeAt(bj(10, 0, 0)), bj(12, 0, 0), '周一 10:00 → 12:00 出峰')
assert.strictEqual(nextPeakChangeAt(bj(13, 0, 0)), bj(14, 0, 0), '周一 13:00 → 14:00 进峰')
assert.strictEqual(nextPeakChangeAt(bj(18, 0, 0)), sec('2026-10-20T09:00:00+08:00'), '周一 18:00 → 周二 09:00 进峰')
assert.strictEqual(nextPeakChangeAt(sec('2026-10-16T18:00:00+08:00')), sec('2026-10-19T09:00:00+08:00'), '周五 18:00 → 下周一 09:00（跨周末）')

// 状态封装
const st = pricingState(bj(10, 0, 0) * 1000)
assert.strictEqual(st.isPeak, true)
assert.strictEqual(st.label, '高峰价')
assert.strictEqual(st.multiplier, 2)
assert.ok(st.nextChangeAt > 0)

console.log('✅ 全部断言通过：工作日峰谷边界 / 周末谷价 / 法定节假日谷价 / 下一切换点 / 状态封装')
