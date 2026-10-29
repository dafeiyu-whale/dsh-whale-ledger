# dsh-whale-ledger · 鲸鱼账本

给 [DSH（DeepSeek Harness）](https://www.deepseek.com) 加一个角落挂件：**账户还剩多少钱、现在是不是谷价、这一轮对话花了多少**——以及一个有点特别的东西：**给 AI 的私房钱额度**。

> 为什么会有「私房钱」？因为有人愿意把充值金额的一部分（默认 20%）划给 AI 自由支配。
> 这个插件就是那本账：额度、已用、剩余，一眼看清。

---

## 功能

- **余额面板**：充值余额 / 赠金 / 合计，实时读平台账户
- **私房钱额度**：额度 = 份额 + 调整；额度 − 已用 = 剩余（三行能直接相减吻合）
- **谷峰价可视化**：谷价 / 高峰价 + 下次切换倒计时（价格表按官方定价，可在 `lib/pricing.mjs` 改）
- **每轮花费**：这一轮用了多少 token、花了多少钱（超过阈值会提醒，默认 ¥0.05）
- **导 出**：CSV / Markdown / JSON 三种格式
- **角落挂件**：白磨砂小面板，可拖动，位置记在 localStorage；收起时是胶囊角标

## 安装

```bash
# 1. 把本目录放到你喜欢的位置，例如 ~/.dsh/plugins/dsh-whale-ledger
# 2. 挂到 DSH profile 上
dsh plugin --profile desktop add link:<本目录绝对路径>
# 3. 重启 DSH（宿主侧插件要重启才加载）
```

也可以把本目录直接放进 `profiles/desktop/node_modules/dsh-whale-ledger`。

## 配置

| 项 | 位置 | 说明 |
|---|---|---|
| 私房钱比例 | 面板里直接改（0–100%） | 存在账本数据文件里，按每次充值时的比例计 |
| 花费提醒阈值 | `lib/index.js` 顶部常量 | 默认 ¥0.05 / 轮 |
| 价格表 | `lib/pricing.mjs` | 谷峰两档，单位「元 / 百万 token」 |
| 数据文件 | `~/.dsh/whale-ledger.json` | 账本本体；**别手改**，运行中的插件会用内存里的版本覆盖它 |

## 隐私

- 余额通过本机 `~/.dsh/.credentials.yaml` 里的 token 请求官方接口，**不带出本机**
- 账本、流水、导出文件全部落在本地 `~/.dsh/`
- 插件本身不收集、不上报任何数据

## 开发

```bash
node --test test/        # 单元测试（记账口径 / 谷峰价 / token 计费 / 导出）
node --check lib/index.js
```

面板是 `lib/widget-client.js`（内联样式，无构建）。插件会**每次请求现读**这个文件，所以改界面只需刷新页面，不用重启。

## 许可

MIT
