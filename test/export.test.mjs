// 账本导出单元测试（node test/export.test.mjs）
import assert from 'node:assert'
import { addEntry, freshLedger, observeBalance } from '../lib/accounting.mjs'
import { exportCsv, exportMarkdown } from '../lib/export.mjs'

const l = freshLedger()
addEntry(l, { kind: 'recharge', owner: 'user', amount: 50, note: '基线充值', at: Date.parse('2026-10-17T19:33:00+08:00') })
addEntry(l, { kind: 'spend', owner: 'fish', amount: -0.5524, note: '定价调研', at: Date.parse('2026-10-17T21:30:00+08:00') })
addEntry(l, { kind: 'spend', owner: 'fish', amount: -1.262916, note: 'P3 开发', at: Date.parse('2026-10-18T21:20:00+08:00') })
observeBalance(l, { at: Date.parse('2026-10-18T21:38:00+08:00'), total: 41.9160212, recharge: 41.9160212, bonus: 0 })

// Markdown：关键字段齐全
const md = exportMarkdown(l)
for (const needle of ['鲸鱼账本', '基线充值', '定价调研', 'P3 开发', '充值累计', '剩余', '余额观测', '2026-10-18', '41.9160']) {
  assert.ok(md.indexOf(needle) !== -1, 'MD 缺少: ' + needle)
}
assert.ok(md.indexOf('+50.0000') !== -1, 'MD 充值金额格式')
assert.ok(md.indexOf('-1.2629') !== -1, 'MD 花费金额格式')
assert.ok(md.indexOf('账本主人') !== -1, 'MD 归属标注')

// CSV：表头 + 行数 + 转义
const csv = exportCsv(l)
const csvLines = csv.split('\r\n')
assert.strictEqual(csvLines[0], '流水表')
assert.ok(csvLines[1].indexOf('序号,北京时间,北京日,类型,归属,金额(元),备注') === 0, 'CSV 流水表头')
const entryLine = csvLines.find((x) => x.indexOf('定价调研') !== -1)
assert.ok(entryLine && entryLine.indexOf('-0.55240000') !== -1, 'CSV 金额精度 8 位')
const obsIdx = csvLines.indexOf('观测表')
assert.ok(obsIdx > 0, 'CSV 观测表存在')
assert.ok(csvLines[obsIdx + 1].indexOf('北京日,首次观测,最后观测,总余额(元),充值(元),赠金(元)') === 0, 'CSV 观测表头')
assert.ok(csvLines[obsIdx + 2].indexOf('2026-10-18') === 0, 'CSV 观测行')

// CSV 转义：含逗号的备注
addEntry(l, { kind: 'adjust', owner: 'user', amount: 0.01, note: '含,逗号"引号' })
const csv2 = exportCsv(l)
assert.ok(csv2.indexOf('"含,逗号""引号"') !== -1, 'CSV 特殊字符转义')

console.log('✅ 全部断言通过：MD 结构字段 / CSV 表头行数与精度 / 特殊字符转义')
