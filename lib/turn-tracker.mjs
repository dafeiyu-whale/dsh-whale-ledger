// dsh-whale-ledger · 轮次花费追踪（P3）
// 依据 whale-widget 实测的 DSH Host 事件契约：
//   'session/event' → assistant/message 事件带 { turn, usage: {inputTokens, cacheReadTokens, outputTokens},
//     message: { source: { model } } }；turn/end 时结算本轮。
//   'subagent/start'|'subagent/end' → info.id 为子会话 id。
// 计费口径与 whale-widget 一致：outputTokens 已含 reasoningTokens（DSH 保证），不重复计费。
import { addMoney } from './accounting.mjs'
import { isPeakTime, PRICE_TABLE } from './pricing.mjs'

export function priceForModel(model) {
  const m = String(model || '').toLowerCase()
  for (const key of Object.keys(PRICE_TABLE)) {
    if (key && m.indexOf(key) !== -1) return PRICE_TABLE[key]
  }
  return PRICE_TABLE['deepseek-flash']
}

// 单条 assistant/message 的花费（元）与 token 数
export function messageCost(usage, model, timeSec = Date.now() / 1000) {
  const input = Number(usage && usage.inputTokens) || 0
  const cache = Number(usage && usage.cacheReadTokens) || 0
  const output = Number(usage && usage.outputTokens) || 0
  const p = priceForModel(model)
  const off = isPeakTime(timeSec) ? 1 : 0
  const cost = (cache / 1e6) * p.hit[off] + (input / 1e6) * p.miss[off] + (output / 1e6) * p.out[off]
  return { cost, tokens: input + cache + output }
}

export function newTurnAgg(turn) {
  return { turn, cost: 0, tokens: 0, byModel: {}, byModelTokens: {}, lastTs: Date.now() }
}

export function addUsage(agg, usage, model, timeSec) {
  const { cost, tokens } = messageCost(usage, model, timeSec)
  agg.cost = addMoney(agg.cost, cost)
  agg.tokens += tokens
  const m = model || 'unknown'
  agg.byModel[m] = addMoney(agg.byModel[m] || 0, cost)
  agg.byModelTokens[m] = (agg.byModelTokens[m] || 0) + tokens
  agg.lastTs = Date.now()
  return agg
}
