# Pi 运行时直接使用 DeepSeek API

本项目的模型运行路径为：**Pi Agent → pi-ai 的 OpenAI-compatible adapter → 官方 DeepSeek API**。没有本地部署大模型，也没有把 DeepSeek 仅当作离线调研助手。数据库查询、证据校验和任务持久化仍在应用服务器完成。

## 当前模型与接口

2026-11-25 实际鉴权读取 `/models` 成功，返回 `deepseek-flash` 和 `deepseek-v4-pro`。默认选择 `deepseek-flash`，基地址 `https://api.deepseek.com`；模型目录结果不是推理效果验证。

模型名称、工具调用和默认 thinking 行为参考 [官方模型页](https://api-docs.deepseek.com/quick_start/pricing/)、[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/) 与 [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。供应商可能更新同名模型的实际版本；原始 assistant 消息中的模型元数据与运行日期一起保存。

## 配置

```bash
export DEEPSEEK_API_KEY='YOUR_KEY'
export METRICLAB_MODEL_URL=https://api.deepseek.com
export METRICLAB_MODEL_ID=deepseek-flash
export METRICLAB_CONTEXT_WINDOW=1048576
export METRICLAB_MAX_CONTEXT_BYTES=16384
export METRICLAB_REQUEST_TIMEOUT_MS=90000
npm start
```

密钥只在后端环境中读取，不进入 `Model` 对象、任务配置指纹、API 返回、浏览器或报告。项目中的 [.env.example](../.env.example) 只有空值和公开配置；应用不会自动读取工作目录里的任意 `.env` 文件。源码和报告都不包含实际密钥。

`METRICLAB_MODEL_URL`/ID 省略时默认使用官方 DeepSeek 和 `deepseek-flash`；生产环境仍建议显式配置。没有后端密钥时网页为检查模式。`--scripted-control` 是独立的固定控制演示，不会偷偷当作 API 成功结果。

## 工具调用设置

本版显式发送 `thinking: { type: 'disabled' }`，以验证业务工具协议与完整流程。官方模型默认可能启用 thinking，不能只给 Pi 设置 off 就假定 provider 的默认也关闭。因此在 adapter 的 `samplingParams` 中明确指定，并用真实适配器加受控 fetch 检查最终请求。

本版使用常规工具调用，不启用 Beta strict。应用自己的 schema、日期、指标、证据校验仍是权威边界。若将来启用 thinking，需要保持工具轮次所需的 reasoning 状态传递，重新冻结配置并测试；当前不声称已验证 thinking 模式研究或模型对比。

## 额度和记录

[实际 API 集成方案](../examples/deepseek-protocol.json) 在发出请求前固定两个业务用例，总请求上限 9、输出 token 上限合计 7,680、单次规范化上下文 JSON 上限 16 KiB、完整响应截止 90 秒。两个用例分别验证月度净销售额/国家贡献，以及时间与指标不明确时的澄清。

每次请求在 SQLite 预留，provider 内部重试为 0，未知尝试继续计入额度。上下文超限在发出前拒绝。应用保留模型返回的 token usage 和按公开峰时单价计算的估计成本；它不是供应商账单，也不是所有部署环境的精确货币预算。

无本地模型加载、训练或 GPU 占用。旧 CPU 模型尝试仅保留为历史失败记录；用户明确运行方式后已停止，不能算作 DeepSeek 的成绩。

## 框架研究版本

上面的 `deepseek-protocol.json` 属于原版 SDK 应用基线，现已关闭。框架 v1 的业务与上下文方案、v2 的 `native-v2-protocol.json` 与 `context-v2-protocol.json` 分别冻结并运行，全部结果见 [validation.md](validation.md)。v2 共 22 次真实请求（业务 5、审计 17），不追加自动付费重试。v3 只修复逐路径错误处理，未做真实 API 复测。

## 运行研究与业务应用的区别

本项目不以两个集成用例声称模型准确率。后续若研究不同 DeepSeek 模型或 thinking 策略，应单独冻结任务集、模型、预算、评分规则和失败处理，再做可比对照。业务应用使用真实 API 只是基础条件，不自动证明某个研究结论。
