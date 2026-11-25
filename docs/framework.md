# PiContextLab：Pi Agent Core 的上下文与工具策略改造

本文是当前项目主线。经营指标应用是验证客户端，不能把接一个 Agent SDK 当作框架改进。用户已明确选择“上下文管理与工具选择策略”，运行时直接使用 DeepSeek API。

## 改动位置与已有能力

固定 Pi 1.6.0 的完整 Agent Core 源码保留在 [vendor/pi-agent-core](../vendor/pi-agent-core)，原文件哈希见 [UPSTREAM.json](../vendor/pi-agent-core/UPSTREAM.json)，MIT 原许可一并保留。派生版本为 `1.6.0-contextlab.3`，不是上游发布或已合入 PR。原研究克隆保持不变。

上游已有 `transformContext`、工具调用屏障、完整的 `pi-durable` 持久化 Harness、摘要压缩，以及部分工具输出限制。本项目不把这些已有能力说成原创。

本次新增的是轻量 Agent Core 中的**原生请求策略入口**：在规范化 transcript 后、真实模型请求前，产生预算内的 provider 视图和该轮执行工具白名单。权威对话记录保持完整。选中的工具声明与实际可执行工具由核心一起检查，而不是只在业务 prompt 里建议少用工具。

## 两个策略组件

1. **工具选择：**按当前任务对名称、描述与参数文档作词法检索，在工具数量和 schema 字节双预算下选择完整依赖组。始终可用的工具显式固定；漏召回时通过 `discover_tools` 检索并在下一轮暴露候选 schema。
2. **上下文管理：**合并但保留全部 system 指令；大段文本工具输出按 SHA256 外置，保留可读取的引用；预算仍不足时，以完整旧 user turn 为单位按相关性/大小与新近性选择，当前用户轮次整体保留。原文和历史索引支持显式、限量、带完整性检查的读取。

这不是新提出的 BM25 算法，也不声称外置就天然无损完成所有任务。原文不丢失与模型能否成功取回、正确使用，是两个需要分别验证的问题。预算度量是 UTF-8 上下文 JSON 字节，实际输入 token 和成本以 provider usage 另行记录。

## 核心接线

- [agent.ts](../vendor/pi-agent-core/src/agent.ts)：注册策略及其通用检索/读取工具。
- [agent-loop.ts](../vendor/pi-agent-core/src/agent-loop.ts)：模型边界调用策略，并把同一轮的选择落实到工具执行集合；声明和执行集合不一致时拒绝发出。
- [model-context.ts](../vendor/pi-agent-core/src/model-context.ts)：通用策略协议，不包含任何电商字段。
- [tool-router.ts](../vendor/pi-agent-core/src/tool-router.ts)：词法排名与工具依赖预算。
- [context-budget.ts](../vendor/pi-agent-core/src/context-budget.ts)：完整事务检查、工具输出外置和历史打包。
- [context-artifacts.ts](../vendor/pi-agent-core/src/context-artifacts.ts)：内容身份、会话范围存储协议与限量 recall。
- [budgeted-policy.ts](../vendor/pi-agent-core/src/budgeted-policy.ts)：组合策略和逐请求审计数据。

没有策略时保留原版路径。对照包以 `@pi-context-lab/upstream-agent-core` 精确别名安装原始 npm 1.6.0，避免把改造后的代码冒充原版基线。

## 安全与协议边界

工具检索不是用户权限系统。宿主仍决定完整注册表和业务权限；策略只会进一步缩小某一轮的可执行集合。没有被该轮声明的注册工具，即使模型输出了名字也不会执行。

历史打包不按任意最后 N 条消息截断：assistant 的工具调用与对应结果必须完整。孤立、重复或缺失结果的导入记录会报错。当前轮次、system 指令和必要工具在外置后仍放不下时，明确拒绝请求，而不是偷偷丢掉用户约束。

外置内容按会话隔离，读取时检查 ID、哈希、长度；JSON pointer 只遍历自有属性；Unicode 读取按 code point 截取；批量调用中单条路径错误单独返回，其他合法字段保留，原文完整性错误仍拒绝整次读取。长内容不被摘要模型改写，但检索策略仍可能漏掉任务需要的信息，需要通过实际评测观察。

## 与验证客户端的关系

PiMetricLab 通过这项原生策略运行领域工具。SQLite 只是通用 artifact store 的一个适配器；把客户端换成文档分析或代码维护，不需要改框架中的业务字段。上下文选择记录由宿主在发请求前按任务 owner/epoch 事务保存，重启恢复工具调用时使用该轮已保存的工具集合。

## 验证要求

至少需要三类证据：原版与改造版的协议/执行边界对照，公开真实工具目录的检索与 schema 开销评测，以及相同 DeepSeek 模型下的任务、token、成本和失败对照。单元控制、公开检索子集和真实业务集成分别报告，不能用一个漂亮的压缩比例代替任务效果。

实现已在服务器编译和验证，实际结果以原始记录和 [validation.md](validation.md) 为准；本文不提前宣称效果提升。

## 实测结论

工具目录字段化未胜过完整文档；v1/v2 上下文审计预算方案均未完成，两轮真实集成与负结果见 [验证记录](validation.md)。v3 修复了批量部分路径错误处理，只有工程回归证据。当前交付的是可选策略接口和可复现验证系统，不是已证明更高成功率的算法。

## 接入示例与迁移

业务宿主的完整接线见 `src/runtime.ts`。最小接入形状如下，artifacts 必须由宿主按会话隔离：

```ts
const policy = new BudgetedContextPolicy({
  artifacts: conversationScopedStore,
  maxContextBytes: 16_384,
  inlineToolResultBytes: 4_096,
  maxTools: 8,
  maxSchemaBytes: 10_000,
  alwaysInclude: ['inspect_dataset', 'request_clarification'],
  dependencies: { breakdown_change: ['compare_metric'] },
  onPrepared: trace => persistBeforeRequest(trace),
});
const agent = new Agent({
  streamFn: deepSeekStream,
  modelContextPolicy: policy,
  initialState: { model: deepSeekModel, tools: businessTools },
});
```

示例中的宿主变量应由集成方实现；不是可脱离项目直接运行的完整程序。每个 Agent 创建一个 policy，不要将可变 registry/会话存储跨用户共享。首次恢复前注册工具，宿主从账本恢复上一轮白名单并先对账未完成 toolCall。按需暴露 utility schemas，因此小任务不会一直承担读取/发现工具的 schema 成本。

去掉 `modelContextPolicy` 可回到无策略路径。自定义策略实现 `ModelContextPolicy` 接口，仍须返回注册工具对象及一致声明；若使用外部权限系统，先限制注册表再交给策略。更换工具、模型、prompt 或策略版本时新建任务，不能静默复用旧配置的请求缓存。

## 冻结源码与重现边界

[evidence/source-snapshots](../evidence/source-snapshots/) 保存当次发出前的原始源码包，其 SHA256 与对应 `evidence/runs/*/protocol.json` 的 `input_bundle_sha256` 一致。包中的历史 README/报告反映当时状态，以本目录当前文档解释结果。v2 和最终 v3 另外保存服务器生成的锁文件；解压后用相应锁覆盖包内旧锁，再 `npm ci --ignore-scripts`。历史 v1/toolret 包保留当时输入，若需严格安装复现，应结合当次精确依赖清单，而非自动升级。

复现真实 API 会产生费用且同名供应商模型可能变化，结果不保证逐字一致。既有输出不覆盖，在新的独立目录运行；本次关闭的研究不会自动重跑。下载原始数据和 ToolRet 目录需使用冻结 URL、版本与哈希；原始 ToolRet 文本不在源码包中。

可移植补丁只含 core 的源码改动，`git apply --check --directory=packages/agent` 已对固定上游通过。它不是上游 PR；standalone 构建所需 package/tsconfig 另在 vendor 提供。
