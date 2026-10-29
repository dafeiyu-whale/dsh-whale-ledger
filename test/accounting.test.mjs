// 账本内核单元测试（node test/accounting.test.mjs）
import assert from 'node:assert'
import { addEntry, beijingDay, detectRecharge, freshLedger, moneyUnits, observeBalance, preciseMoney, quotaSummary, recordRecharges, sumMoney } from '../lib/accounting.mjs'

// 定点金额
assert.strictEqual(moneyUnits('0.1'), 10000000)
assert.strictEqual(preciseMoney('0.1'), 0.1)
assert.strictEqual(sumMoney([0.1, 0.2, 0.7]), 1)
assert.strictEqual(sumMoney([49.2175253, 0.7824747]), 50)

// 北京日
assert.strictEqual(beijingDay(Date.parse('2026-10-18T00:30:00+08:00')), '2026-10-18')
assert.strictEqual(beijingDay(Date.parse('2026-10-17T16:30:00Z')), '2026-10-18') // UTC 16:30 = 北京次日 00:30

// 账本与额度：默认比例 0 → 份额 0；设为 20% 后充值 50 → 份额 10；fish 花 0.5524 → 剩余 9.4476
const l = freshLedger()
addEntry(l, { kind: 'recharge', owner: 'user', amount: 50, note: '充值 50' })
let q = quotaSummary(l)
assert.strictEqual(q.percent, 0)
assert.strictEqual(q.share, 0)
l.fishPercent = 20
q = quotaSummary(l)
assert.strictEqual(q.share, 10)
assert.strictEqual(q.used, 0)
l.fishPercent = 150                      // 越界 → 收敛到 100
assert.strictEqual(quotaSummary(l).percent, 100)
l.fishPercent = -5                       // 越界 → 收敛到 0
assert.strictEqual(quotaSummary(l).percent, 0)
l.fishPercent = 20
addEntry(l, { kind: 'spend', owner: 'fish', amount: -0.5524, note: '研究任务' })
q = quotaSummary(l)
assert.ok(Math.abs(q.used - 0.5524) < 1e-9)
assert.ok(Math.abs(q.remaining - 9.4476) < 1e-9)

// 观测合并：同日两次观测只产生一行
observeBalance(l, { at: Date.parse('2026-10-18T20:00:00+08:00'), total: 50, recharge: 50, bonus: 0 })
observeBalance(l, { at: Date.parse('2026-10-18T21:00:00+08:00'), total: 49.2, recharge: 49.2, bonus: 0 })
assert.strictEqual(l.observations.length, 1)
assert.ok(Math.abs(l.observations[0].lastTotal / 1e8 - 49.2) < 1e-9)

// 非法输入
assert.throws(() => addEntry(l, { kind: 'bad' }))
assert.throws(() => moneyUnits('abc'))

// 充值自动检测
const dl = freshLedger()
observeBalance(dl, { at: Date.parse('2026-10-21T10:00:00+08:00'), total: 28, recharge: 28, bonus: 0 })
let d = detectRecharge(dl, 128)            // +100 → 整数档取整
assert.strictEqual(d.amount, 100)
assert.strictEqual(d.snapped, true)
d = detectRecharge(dl, 28.2)              // 涨幅 <¥0.5 → null（噪声）
assert.strictEqual(d, null)
observeBalance(dl, { at: Date.parse('2026-10-21T11:00:00+08:00'), total: 28, recharge: 28, bonus: 0 })
d = detectRecharge(dl, 73.7)               // +45.7 → 非整数档，待核对
assert.ok(d && d.needsReview === true)
assert.ok(Math.abs(d.amount - 45.7) < 1e-9)

// 平台发票记账（P6）：只记 SUCCESS、按订单 ID 去重；比例按记账当时的 fishPercent 打在该笔上
const rl = freshLedger()
rl.fishPercent = 20
const orders = [
  { payment_order_id: 'A1', amount: '100', currency: 'CNY', payment_order_status: 'SUCCESS', payment_channel: 'WECHAT', paid_at: '2026-10-21T10:09:16+00:00' },
  { payment_order_id: 'A2', amount: '50', currency: 'CNY', payment_order_status: 'SUCCESS', payment_channel: 'ALIPAY', paid_at: '2026-10-16T13:16:11+00:00' },
  { payment_order_id: 'A3', amount: '100', currency: 'CNY', payment_order_status: 'FAILED', payment_channel: 'WECHAT', paid_at: null },
]
let r = recordRecharges(rl, orders)
assert.strictEqual(r.added, 2, '只记 2 笔成功充值')
assert.strictEqual(r.corrected, 0)
assert.strictEqual(quotaSummary(rl).recharged, 150)
assert.strictEqual(quotaSummary(rl).share, 30)
r = recordRecharges(rl, orders)          // 重复调用 → 去重不重复记
assert.strictEqual(r.added, 0)
assert.strictEqual(quotaSummary(rl).recharged, 150)

// 按当次充值比例计算（v2.9）：50@20% + 100@10% → 份额 20（改比例不影响历史笔）
const rl3 = freshLedger()
rl3.fishPercent = 20
addEntry(rl3, { kind: 'recharge', owner: 'user', amount: 50, pct: 20, note: '第一笔' })
rl3.fishPercent = 10
addEntry(rl3, { kind: 'recharge', owner: 'user', amount: 100, pct: 10, note: '第二笔' })
assert.strictEqual(quotaSummary(rl3).recharged, 150)
assert.strictEqual(quotaSummary(rl3).share, 20, '份额按每笔当时比例')
assert.strictEqual(quotaSummary(rl3).percent, 10, '当前比例 = 最新值')

// 手动调整（adjust）：fish 正数补贴 → 剩余增加
addEntry(rl3, { kind: 'adjust', owner: 'fish', amount: 5, note: '应急补贴' })
assert.strictEqual(quotaSummary(rl3).credits, 5)
assert.strictEqual(quotaSummary(rl3).remaining, 25)

// 对账修正（v2.7）：旧方案已记 95，新方案发票 100 → 修正旧条目、不新增
const rl2 = freshLedger()
addEntry(rl2, { kind: 'recharge', owner: 'user', amount: 95, note: '自动检测充值' })
r = recordRecharges(rl2, [{ payment_order_id: 'B1', amount: '100', currency: 'CNY', payment_order_status: 'SUCCESS', payment_channel: 'WECHAT', paid_at: '2026-10-21T10:09:16+00:00' }])
assert.strictEqual(r.added, 0, '对账时不新增')
assert.strictEqual(r.corrected, 1, '修正旧方案金额')
assert.strictEqual(quotaSummary(rl2).recharged, 100)
assert.ok(rl2.entries[0].note.indexOf('修正') !== -1)
assert.strictEqual(rl2.entries[0].ref, 'B1')

console.log('✅ 全部断言通过：定点金额 / 北京日 / 按当次比例 / 手动调整 / 观测合并 / 非法输入 / 充值自动检测 / 发票记账去重')
