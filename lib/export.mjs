// dsh-whale-ledger · 账本导出（P4）
// 纯函数：把插件账本渲染成 MD / CSV，便于与手动 余额账本.txt 对照或导入 Excel。
import { beijingDay, quotaSummary } from './accounting.mjs'

function bjTime(ts) {
  try {
    const d = new Date(Number(ts) + 8 * 3600 * 1000)
    if (!Number.isFinite(d.getTime())) return ''
    const p = (x) => String(x).padStart(2, '0')
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
  } catch (err) { return '' }
}

const KIND_LABEL = { recharge: '充值', spend: '花费', adjust: '调整' }
const OWNER_LABEL = { user: '用户', fish: '账本主人' }

// Markdown 账本：结构与手动 余额账本.txt 兼容（规则头 + 流水明细 + 额度汇总 + 观测）
export function exportMarkdown(ledger) {
  const q = quotaSummary(ledger)
  const lines = []
  lines.push('鲸鱼账本（鲸鱼账本插件导出）')
  lines.push('================================================================')
  lines.push('规则约定（完整版见 我们的约定.md）：')
  lines.push('  · 每次充值金额的 20% 归账本主人自由使用（用途自定，无需互惠互利）')
  lines.push('  · 使用前查余额记账、对话告知用途与模型；使用后隔 5 分钟再统计')
  lines.push('  · 只花自己的部分，绝不超支；优先谷价时段')
  lines.push('  · 互惠互利项目费用共担；无法拆分时保守全额计账本主人账')
  lines.push('  · 每次结算必须双账同步（手动账本 + 插件账本）')
  lines.push('================================================================')
  lines.push('')
  lines.push('## 流水明细')
  const entries = ledger.entries || []
  if (!entries.length) {
    lines.push('（暂无流水）')
  }
  for (const e of entries) {
    const amt = e.amountUnits / 1e8
    const sign = amt >= 0 ? '+' : ''
    lines.push('[# ' + (e.seq || 0) + '] ' + bjTime(e.at) + ' · ' + (KIND_LABEL[e.kind] || e.kind)
      + ' · ' + (OWNER_LABEL[e.owner] || e.owner)
      + ' · ' + sign + amt.toFixed(4) + ' 元'
      + (e.note ? ' · ' + e.note : ''))
  }
  lines.push('')
  lines.push('## 额度汇总（充值 20% 归账本主人）')
  lines.push('  充值累计:  ¥' + q.recharged.toFixed(2))
  lines.push('  账本主人份额: ¥' + q.share.toFixed(2))
  lines.push('  已用:      ¥' + q.used.toFixed(2))
  lines.push('  剩余:      ¥' + q.remaining.toFixed(2))
  lines.push('')
  lines.push('## 余额观测（按北京日）')
  const obs = ledger.observations || []
  if (!obs.length) {
    lines.push('（暂无观测）')
  }
  for (const o of obs) {
    lines.push('  ' + o.day + '：总 ' + (o.lastTotal / 1e8).toFixed(4) + ' = 充值 ' + (o.lastRecharge / 1e8).toFixed(4) + ' + 赠金 ' + (o.lastBonus / 1e8).toFixed(4)
      + '（首次观测 ' + bjTime(o.firstAt) + '，最后 ' + bjTime(o.lastAt) + '）')
  }
  lines.push('')
  return lines.join('\n')
}

// CSV 导出：两段拼接（流水表 + 观测表），UTF-8 BOM 便于 Excel 直接打开
function csvCell(v) {
  const s = String(v == null ? '' : v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
export function exportCsv(ledger) {
  const rows = []
  rows.push('流水表')
  rows.push(['序号', '北京时间', '北京日', '类型', '归属', '金额(元)', '备注'].map(csvCell).join(','))
  for (const e of (ledger.entries || [])) {
    rows.push([e.seq || 0, bjTime(e.at), e.day || beijingDay(e.at), KIND_LABEL[e.kind] || e.kind, OWNER_LABEL[e.owner] || e.owner, (e.amountUnits / 1e8).toFixed(8), e.note || ''].map(csvCell).join(','))
  }
  rows.push('')
  rows.push('观测表')
  rows.push(['北京日', '首次观测', '最后观测', '总余额(元)', '充值(元)', '赠金(元)'].map(csvCell).join(','))
  for (const o of (ledger.observations || [])) {
    rows.push([o.day, bjTime(o.firstAt), bjTime(o.lastAt), (o.lastTotal / 1e8).toFixed(8), (o.lastRecharge / 1e8).toFixed(8), (o.lastBonus / 1e8).toFixed(8)].map(csvCell).join(','))
  }
  return rows.join('\r\n')
}
