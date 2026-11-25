# 研究参考与项目定位

调研日期：2026-11-25。用户确认的 PiAgent 是开源 **Pi coding agent**（`earendil-works/pi`，旧名 `badlogic/pi-mono`），不是本机同名工作目录。本项目固定官方 **v1.6.0 / faac585884ae2c013a6b1400f3e9e77f10b34bac**；网上 main 文档可能比发行版更新。

## 查到的改造路线

| 一手资料 | 实际内容 | 本项目参考点 | 不能据此声称什么 |
|---|---|---|---|
| [pi-agent-notes](https://github.com/juliye2025/pi-agent-notes) | 从最小 Agent、工具/上下文、Router/Workers/Verifier 到应用交付的教程；涉及简历项目组织 | 阅读底层协议后再做业务闭环；区分 mock 控制与真实模型 | 教程通过的 mock 用例不等于我们的模型成绩；多人编排本身不证明成熟 |
| [Pi Data Agent](https://github.com/long1973m/pi-agent) | Pi 数据分析扩展，DuckDB、指标、图表、报告、本地工作台 | 数据分析是有真实输入、结果可核对的业务入口 | 这是领域参考，不是“高星证明”；不照搬其测试数量或产品能力 |
| [DataSQRL 文档](https://docs.datasqrl.com/) / [源码](https://github.com/DataSQRL/sqrl) | 由 Agent 辅助构建数据应用，编译与验证提供确定性反馈 | 模型选步骤，确定性系统检查数据与查询 | 我们没有实现其流式基础设施和部署能力 |
| [pi-temporal](https://github.com/temporalio/pi-temporal) | 围绕 Pi 的持久执行与工具恢复 | 未知结果不能盲目重放；存储、归属、恢复是宿主职责 | 我们没有依赖 Temporal，也没有获得分布式 exactly-once |
| [Pi 官方源码](https://github.com/earendil-works/pi) | 模型接口、Agent 核心、coding agent 与扩展机制 | 选择适合业务宿主的 core/ai/schema 层 | coding agent CLI 不等于一个开箱即用的电商平台 |

`pi-agent-notes` 是有明确教学/简历语境的参考。其部分代码锁定 1.0.0，不能把旧 API 直接套到 1.6.0。本项目独立实现业务代码；未复制该教程的代码或大段文字。其他参考按技术相关性选择，不把星标数当质量验证。以后贡献 PR 的“小团队、高星优先”偏好保持不变，本项目未对这些参考仓库发起 PR 或 issue。

## 为什么选择指标调查

“上传文档 → 检索 → 聊天”很容易停留在演示。这里的完整工作单元是：**订单明细 → 数据质量 → 明确口径 → 可比期间 → 分组贡献 → 查询证据 → 封存报告 → 人工复核**。

这条路径既能让模型决定调查顺序，也能提出不依赖模型主观评价的验收标准：金额是否精确、订单是否去重、退款符号是否正确、期间是否完整、分组是否和总额对齐、进程中断后是否重复消费额度。

本版没有为了展示“多 Agent”而拆出多个角色。一个有明确工具边界的 Pi Agent 更容易定位错误、控制成本和重现调查。未来只有在并行独立调查、交叉验证或多业务域出现实际需求时，才有理由增加多 Agent 编排。

## 真实数据依据

[UCI Online Retail 官方数据页](https://archive.ics.uci.edu/dataset/352/online+retail) 和 [DOI](https://doi.org/10.24432/C5BW33) 提供来源、许可和字段背景。数据为历史英国零售交易，价格币种 GBP；包含匿名客户标识。实际工作簿中的缺失情况以本项目实测为准，不能直接照抄数据卡的缺失值标签。

项目新增指标定义是本项目的分析选择，并非 UCI 作者对会计收入、现金流或因果关系的认定。所有公开演示都属于历史公开数据分析。
