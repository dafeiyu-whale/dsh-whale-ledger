// 轮次花费追踪单元测试（node test/turn-tracker.test.mjs）
import assert from 'node:assert'
import { addUsage, messageCost, newTurnAgg, priceForModel } from '../lib/turn-tracker.mjs'

const valleySec = Date.parse('2026-10-18T21:00:00+08:00') / 1000 // 周日 = 谷价
const peakSec = Date.parse('2026-10-19T10:00:00+08:00') / 1000 // 周一 10:00 = 高峰

// 模型匹配
assert.ok(Math.abs(priceForModel('deepseek-v4-pro').miss[0] - 4.5) < 1e-9)
assert.strictEqual(priceForModel('some-unknown'), priceForModel('deepseek-flash'))

// Flash 谷价：未命中输入 1/百万、缓存命中 0.02/百万、输出 4/百万
assert.ok(Math.abs(messageCost({ inputTokens: 1e6 }, 'deepseek-flash', valleySec).cost - 1) < 1e-9)
assert.ok(Math.abs(messageCost({ cacheReadTokens: 1e6 }, 'deepseek-flash', valleySec).cost - 0.02) < 1e-9)
assert.ok(Math.abs(messageCost({ outputTokens: 1e6 }, 'deepseek-flash', valleySec).cost - 4) < 1e-9)

// Flash 高峰 = 谷价 × 2
assert.ok(Math.abs(messageCost({ inputTokens: 1e6 }, 'deepseek-flash', peakSec).cost - 2) < 1e-9)

// Pro：谷价未命中 4.5、高峰 9.0
assert.ok(Math.abs(messageCost({ inputTokens: 1e6 }, 'deepseek-v4-pro', valleySec).cost - 4.5) < 1e-9)
assert.ok(Math.abs(messageCost({ inputTokens: 1e6 }, 'deepseek-v4-pro', peakSec).cost - 9.0) < 1e-9)

// token 合计（outputTokens 已含 reasoning，不再重复）
const mc = messageCost({ inputTokens: 1e6, cacheReadTokens: 5e5, outputTokens: 2e5 }, 'deepseek-v4-pro', valleySec)
assert.strictEqual(mc.tokens, 1700000)

// 聚合与按模型拆分
const agg = newTurnAgg(3)
addUsage(agg, { inputTokens: 1e6 }, 'deepseek-v4-pro', valleySec)
addUsage(agg, { outputTokens: 1e6 }, 'deepseek-flash', valleySec)
assert.ok(Math.abs(agg.cost - (4.5 + 4)) < 1e-9)
assert.strictEqual(agg.tokens, 2000000)
assert.ok(Math.abs(agg.byModel['deepseek-v4-pro'] - 4.5) < 1e-9)
assert.ok(Math.abs(agg.byModel['deepseek-flash'] - 4) < 1e-9)

console.log('✅ 全部断言通过：模型匹配 / 谷峰价换算 / 缓存命中 / token 口径 / 聚合拆分')
