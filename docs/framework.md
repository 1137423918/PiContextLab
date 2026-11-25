# PiContextLab：Pi Agent Core 的上下文与工具策略改造

本文是当前项目主线。经营指标应用是验证客户端，不能把接一个 Agent SDK 当作框架改进。用户已明确选择“上下文管理与工具选择策略”，运行时直接使用 DeepSeek API。

## 改动位置与已有能力

固定 Pi 1.6.0 的完整 Agent Core 源码保留在 [vendor/pi-agent-core](../vendor/pi-agent-core)，原文件哈希见 [UPSTREAM.json](../vendor/pi-agent-core/UPSTREAM.json)，MIT 原许可一并保留。派生版本为 `1.6.0-contextlab.11`，不是上游发布或已合入 PR。原研究克隆保持不变。

上游已有 `transformContext`、工具调用屏障、完整的 `pi-durable` 持久化 Harness、摘要压缩，以及部分工具输出限制。本项目不把这些已有能力说成原创。

本次新增的是轻量 Agent Core 中的**原生请求策略入口**：在规范化 transcript 后、真实模型请求前，产生预算内的 provider 视图和该轮执行工具白名单。权威对话记录保持完整。选中的工具声明与实际可执行工具由核心一起检查，而不是只在业务 prompt 里建议少用工具。

## 两个策略组件

1. **工具选择：**按当前任务对名称、描述与参数文档作词法检索，在工具数量和 schema 字节双预算下选择完整依赖组。始终可用的工具显式固定；漏召回时通过 `discover_tools` 检索并在下一轮暴露候选 schema。
2. **上下文管理：**合并但保留全部 system 指令；先按路由后实际上下文判断压力，只有超预算才将较大文本工具输出按 SHA256 外置，满足预算即停止，保留可读取的引用；预算仍不足时，以完整旧 user turn 为单位按相关性/大小与新近性选择，当前用户轮次整体保留。原文和历史索引支持显式、限量、带完整性检查的读取。

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

## 请求绑定的恢复（宿主加固）

最初宿主从 `context_prepared` 事件里取最近一条工具集合。这有两个问题：事件接口按 500 条分页；最新准备事件也不一定对应待恢复的 assistant 响应。工具选择的审计记录不能替代执行授权关联。

当前 SQLite `call_tool_sets` 在预留请求的同一事务保存该次选择，响应落盘时保存完整 assistant 内容身份。Pi 在返回后附加的 `thinkingLevel` 不参与这个身份，其余内容、调用参数、时间与 usage 都参与。恢复按“本任务 + 保存响应身份”查找集合，不使用 UI 事件列表。找不到或存在冲突时暂停，不回退到全部注册工具；注册表或运行配置改变也要求新建任务。

完成响应缓存复用时核对同一请求关联的工具集合，集合不同即拒绝。pending/unknown 请求仍占原额度。此关联只约束本应用的恢复与执行，不提供跨外部系统 exactly-once。

事件 SSE 仍按 cursor 顺序分页；任务快照使用最近 500 条，并单独读取最新策略供界面显示。持久澄清从数据库直接判断，恢复时已进入澄清的任务不再额外请求模型。

这部分是宿主对原生策略的持久化集成，不是 Pi 上游已合入的功能。工程反例与验证见 [validation.md](validation.md)。旧版任务没有该绑定或运行指纹不同，保持暂停并新建调查，不能偷偷推测其执行集合。

## 可选 JSON 字段定位与精确数值回查（contextlab.4）

v2 失败轨迹表明：知道 artifact ID 不代表知道 JSON 内部路径。新增 `artifactSearch: true` 选项；在需要外置/归档时，原生策略同时暴露 `search_context_artifact` 和读取工具，二者 schema 一起纳入原有预算。小上下文保持隐藏；低预算放不下必需工具时拒绝。通用默认不启用；v4研究时的验证客户端显式启用，当前普通入口改为默认关闭。没有附加 LLM 调用或任意代码执行。

搜索输入是现有 artifact、自然语言字段查询和结果数量。遍历 JSON 叶字段，用路径、少量相邻短标签和 scalar 前缀构建词法文档，再用固定 BM25 排序。返回来源 JSON pointer、精确值的有界预览、类型、截断状态和分数。没有电商字段特判，也没有把评分目标喂给检索。

限制：源文本最多 8 MiB；最多 20,000 个节点、32 层、4,096 个字段、512 字符路径；每个预览最多 256 code points，整个搜索 payload JSON 最多 8 KiB。`scan.complete` 仅表示结构遍历是否完整，不表示语义检索或值内容全文覆盖；路径/预览可能漏召回，找不到不能证明字段不存在。长值继续用精确读取工具读取。

另修复普通 `JSON.parse → JSON.stringify` 在大整数、高精度小数、指数及负零上的改变。解析通过标准 reviver source context 记住数字的原始字面；按路径读取数字或容器时保留它们，以文本返回。容器空白和字符串转义会规范化，整段原始字节仍通过空 pointer 读取；不要把文本再次转成 JS Number 后声称精度仍完整。运行时不支持 source context 时拒绝精确数值解析；服务器 Node22.23.5 已验证。占位符不再暴露不安全的数值身份猜测。

原文 SHA256 与会话归属在搜索前校验，搜索结果不改原文或权威对话。该功能仍是 opt-in 的程序机制，尚未得到 DeepSeek 任务成功率提升的实测证据。v1/v2 付费研究保持关闭。

辅助解析对象中的 JS `value` 仅用于遍历结构；需要保真文本时使用 `text/json` 方法或原文读取工具，不直接序列化该 JS value。字段定位仍为实验性接口，8 条诊断没有证明组合检索优于仅路径基线，详见验证记录。

## CPU 诊断复现入口

冻结输入在 `evidence/artifact-search/inputs`，只含本项目公开提交的元数据与锁文件。该诊断被测端为 contextlab.4（提交 `fc2d13c`），应检出该版本并使用其 lock。另在服务器单独检出提交 `02f69f7`，用它自己的 lock 安装并构建 v3，保留该对照目录。以下命令在已构建的 contextlab.4 中运行：

```bash
node dist/scripts/eval-field-location.js \
  evidence/artifact-search/inputs \
  /path/to/fresh-field-diagnostic.json \
  /path/to/frozen-contextlab3/vendor/pi-agent-core/dist/index.js
```

输出必须是新文件；该脚本不读取模型密钥或调用模型。它重现既有诊断，不构成未见过的验证，不能覆盖原结果或用于重复挑分数。真实模型的后续效果研究需要独立新任务和预先冻结的方案。随后已按独立新方案完成v4付费研究，结果为负，见验证记录。

## v4 对照后的默认策略

真实源审计中，完整上下文完成两个案例，两种预算策略均未完成，累计输入还更高。当前真实入口与Runner默认不启用ModelContextPolicy；`METRICLAB_CONTEXT_POLICY=budgeted`才启用，字段定位另由`METRICLAB_ARTIFACT_SEARCH=1`选择。原生SDK的Agent本来就只在传入policy时启用。脚本演示和针对策略的控制显式启用budgeted，仍验证原生执行集合与恢复。

这次默认值调整是减少未证实策略对普通任务的影响，不是新的效果提升实验。源码、35项预检、23请求研究和37项发布控制分别留存；复现研究使用先行发布的abd69e2版本，结果不由当前默认值重算。


## contextlab.5：按压力触发、整批回读保护与续读协议

v4 轨迹暴露了可在 CPU 上单独检验的程序行为，但没有证明它们是模型失败的唯一原因。v5 改动如下：

1. 先以业务工具与必要发现工具完成路由，再通过 `modelContextView` 测量规范化 provider 上下文 JSON；移除仅显示的 `details`，不把未选中 schema 算入压力。这里不是供应商 HTTP 请求体大小或 tokenizer 计数。
2. 默认 `spillMode: 'pressure'`。视图已在预算内时直接保留工具结果，不写 artifact，也不为“超过单条阈值”额外预留读取 schema。超预算时才加入读取工具；字段搜索仍由 `artifactSearch` 显式决定，再共同计入 schema 和上下文预算。
3. 对超过单条阈值的普通纯文本工具结果，按内容字节降序尝试外置。替代引用必须更小，重建视图后达到预算就停止；这不是全局最优背包算法。仍放不下才沿用完整旧轮归档，强制部分超限则拒绝。
4. 最近一个已完成 assistant 工具批次里的所有 `read_context_artifact` / `search_context_artifact` 结果一起保护，不再仅保护最后一条。较早批次仍可能外置；若最新批次本身太大，保持显式拒绝，不承诺任何读取都能放下。
5. 每条成功读取返回 `returned_codepoints`、`next_offset` 与 `next_read`。`next_read` 包含该 pointer 单独续读的完整参数，按实际返回长度前进，结束时为 null。多个 pointer 共享本次 limit，因此模型不应从请求 limit 自行计算下一页。

例如 limit=11，第一字段使用3个code points，第二字段仅获得8个；第二字段的下一次 offset 必须是8，而不是11。共享预算耗尽时可返回0个字符及同 offset 的单字段续读参数；下次独立调用恢复完整 limit，能够前进。emoji 按 code point 计数，不按 UTF-16 单元。非法路径独立报错，完整性失败仍拒绝整个读取。

`spillMode: 'threshold'` 仅为明确选择的旧触发方式兼容选项，仍使用新版批次保护与续读接口，不代表完整复现旧版本。严格复现 v4 需要检出旧提交。审计新增 `normalizedBeforeBytes`、`trigger`、`spillMode` 和 `protectedRecallCallIds`；UI 使用规范化前后字节作比较，权威历史保持原样。

新版继续保持真实入口默认完整上下文，预算策略为 opt-in。验证为新的合成机制控制和工程回归，没有追加 DeepSeek 请求；不能据此宣称修复了实际模型失败、降低累计 token 或提高成功率。对照、原始测试和失败类型检查见 [验证记录](validation.md)。


## contextlab.6：有界目录索引复用

此前 `routeTools` 在每次请求中重新分词并建立整个工具目录的 BM25 统计。`ContextLexicalIndex` 已支持多次 score，但实际原生策略没有复用它。新增 `ToolRoutingIndexCache`，将这个可复用索引接入正常路由和 `discover_tools`，不改变评分公式、依赖闭包或预算规则。

缓存以有序工具声明 JSON 和实际检索文档的逐字符串相等作为命中条件，每次请求仍重新读取并比较当前元数据。因此同一数组或同一工具对象被就地修改时，也会失效重建；新增、删除、改名、排序、schema、描述和自定义文档变化都能检测。它不靠数组地址或一个可能忘记更新的版本号判断一致性。代价是命中时仍需 O(目录文本大小) 的序列化与比较，尚未消除大目录扫描。

缓存只保存声明/文档快照与词法统计，不保存 query、答案、选择结果或 execute 函数。每轮依赖、必选项、提升候选及预算重新计算；选中的可执行对象从当前注册表取得。即使元数据完全相同而实现函数被替换，也使用新对象。核心声明/执行校验与宿主权限仍照常生效。

原生 policy 默认创建属于本实例的缓存；不使用进程全局缓存。独立使用 `routeTools` 时可显式传入 `indexCache`；不传则保留每次构建路径。默认最多2个目录快照、合计32MiB的声明/文档 UTF-8源字节，超限的目录只临时评分、不保留；淘汰按LRU执行。该源字节上限不等于JavaScript堆内存上限，索引对象也占内存。`clear()` 释放目录保留，计数器保留。`stats` 和 prepare trace 提供命中、构建、淘汰、旁路及源字节记录。

```ts
const indexCache = new ToolRoutingIndexCache({
  maxEntries: 2,
  maxSourceBytes: 32 * 1024 * 1024,
});
const decision = routeTools(currentQuestion, registeredTools, {
  maxTools: 8, maxSchemaBytes: 8192, alwaysInclude: [], indexCache,
});
```

缓存优化与模型效果不同：这里要求与冻结旧版对同一输入产生完全相同的所有排名分数、顺序、schema成本和选择，而不是修改检索质量。新的CPU性能方案使用真实37,292工具目录，仅导出工具元数据；旧101条查询和标签不进入驱动。重复名称被命名空间化，原始名称保留在描述和字段检索文档中；其中1,211条非对象参数描述包在惰性对象schema的`x-catalog-parameters`字段下，原始参数文本仍用于检索文档；所有行保留。这些旧schema仅序列化作负载，不实际执行API。八条新查询按预定双向顺序比较，完整样本保留，不据时间结果调参或重试。结果见 [验证记录](validation.md)。


## 源码冻结和新业务验证

新的`source_snapshot.py`使用明确的源码目录/后缀与必要fixture清单，生成带逐文件SHA256的归档；不再把历史结果、原始数据、环境、私有状态及旧压缩包套入新包。相同输入归档字节可重复，拒绝选中源码中的symlink。服务器控制验证必要源码/oracle存在、排除项、逐文件hash、可重复字节和symlink拒绝。源字节清单只是重现身份，不替代服务器编译与行为检查；已有冻结历史不修改。

新的真实任务方案在[运行前说明](evaluation-business-v6-plan.md)和[机器协议](../examples/business-v6-protocol.json)。`oracle_business_v6.py`独立CSV/Decimal计算全部分组，`validate-business-v6.ts`在发请求前同DuckDB核对Top/OTHER与总额，研究后另用`audit_business_rows_v6.py`核对全部保存分组行，`business-evaluation.ts`同时检查请求身份、哈希、金额及Top/OTHER。`run-business-v6.ts`使用原生Runner和DeepSeek provider，固定预算并持久保留wire输入/请求预留；不会把oracle答案加入模型上下文。默认真实入口配置保持不变。


## contextlab.7：多个中等结果的累计压力

真实零售数据的三指标/六分解控制暴露了旧候选门槛：每条结果都不超过4KiB，但总视图超过24KiB；旧版不外置任何结果，也没有可归档旧轮，只能拒绝。它是可单独复现的程序限制，尚不是模型失败原因推断。

新版压力模式仍按结果字节降序尝试；单条阈值成为优先级而不是硬过滤条件。达到总预算即停止，引用必须确实比原文小，才写artifact；最近完整回读批次仍保护，system与当前轮不丢弃。`belowThresholdSpills`记录不超过旧单条阈值的外置，原文与精确来源ID照常保留。无压力时零写入；显式threshold兼容模式仍按硬阈值工作。逐候选检查取消信号。

这不是任意压缩小结果：仅在总压力确实存在时尝试，负收益替换跳过。控制任务需从provider视图而不是Store取9个真实证据ID，独立核对全部SQL分组、Top/OTHER与金额恒等式。源码、旧版拒绝和新版控制见[多指标方案](evaluation-pressure-business-plan.md)，实际验证状态见[验证记录](validation.md)。


## contextlab.8：有界参数校验反馈

上一项真实研究的完整分支三次返回过长interpretation，schema拒绝是正确行为；上游错误文本还附带完整Received arguments，导致反馈本身再次占据上下文。新增SDK可选项`toolValidationFeedback: 'bounded'`，只在`validateToolArguments`拒绝阶段格式化结果。原来的参数准备、验证、coercion和clone调用保持原样，不自动截断参数、不放宽schema；无效输入不进入before/execute/after。

模型收到可解析JSON文本，包含INVALID_TOOL_ARGUMENTS、原始字段诊断前缀、诊断截断标记、是否省去参数dump，以及最多8个顶层字段的形状。字符串给出code point数与UTF-16单位数，数组给出项数；字段名以RFC6901 pointer表示，过长字段名省略，字段形状不包含对应值。计数发生在prepareArguments之后，明确标注argument_stage；它不声称覆盖嵌套所有字段。

整个`content`数组JSON序列化后最多2,048 UTF-8字节，包括两层JSON转义和包装。超长诊断按code point边界二分截取，仍是完整可解析JSON；元数据details只保存原错误字节数和实际反馈字节数，不再藏一份完整dump。完整原始assistant参数仍在权威历史中（JSON解析失败时同时保留argumentsError里的原始输入）；自定义prepareArguments产生的临时值不是原始assistant参数，此处只记录其字段形状。

SDK缺省仍保留原版错误文本。独立runToolCall也接受同名选项；PiMetricLab在正常Agent与恢复runToolCall中都显式开启，并加入运行指纹`bounded-2048-v1`，旧任务不静默复用。未知工具、取消、prepareArguments异常、before/after hook异常和execute异常仍走原路径；这不是所有错误统一2KiB或敏感内容脱敏功能。

```ts
const agent = new Agent({ streamFn, toolValidationFeedback: 'bounded', initialState });
const outcome = await runToolCall(call, {
  tools, assistantMessage, context, toolValidationFeedback: 'bounded',
});
```

本轮只做服务器CPU机制验证，不再调用DeepSeek、不重跑已关闭压力任务。脚本provider按反馈进行下一步只验证回合/执行边界，不代表真实模型会纠正。实际字节和测试见验证记录，原研究失败分数保留。

## contextlab.9：同一批次共享 recall 内容预算

单次最多4,096个code points仍不足以约束并行读取总量：Unicode、JSON转义和元数据都占字节，同一assistant可以调用多次。新增[tool-result-budget.ts](../vendor/pi-agent-core/src/tool-result-budget.ts)，在原生循环收到完整assistant后、任何工具开始之前，按本轮允许的实际工具及`resultBudget`元数据一次性分配。配额不进入模型参数，不改原始调用。

```ts
const groups = { 'context-recall': 8192 };
const agent = new Agent({
  streamFn, initialState,
  modelContextPolicy,
  toolResultBudgets: groups,
});
```

读取与字段定位声明同一`context-recall`组，每个调用最低256、最高8,192字节。分配先保证各调用最低额，再对尚未到上限的调用平分余额，余数按原调用顺序分配；相同四个读取各得2,048。配额固定，不根据完成顺序或实际返回量临时回收，因此串行、并行行为一致，但可能有闲置空间。分组预算未显式配置时，SDK保持旧结果行为，元数据本身不启用限制。

组预算、工具元数据必须是有效安全整数；组内最低额合计放不下时整批执行前拒绝。重复call ID也拒绝，避免配额身份覆盖。Agent正常结束失败状态，低层`agentLoop`和`agentLoopContinue`返回错误assistant并结束事件流，不让消费者一直等待；原发起调用的assistant仍留存。此处是终止失败，未执行的调用不会伪装成已经完成的工具事务，也不自动恢复执行或请求模型重试。

执行函数可通过第五个宿主参数`execution.resultBudgetBytes`获取配额。读取先按原JSON pointer、共享code point上限和精确数字文本生成结果，再测量**完整content数组JSON的UTF-8字节**；过长则安全缩小返回前缀。`next_offset`及`next_read`按实际返回code points推进，绝不按原limit跳过。字段之间仍共享原limit。二分寻找可容纳前缀只保证安全可容纳，不声称跨EOF元数据变化时取得全局最长前缀。空内容元数据也放不下时返回紧凑`status: 'deferred'`，原参数与artifact不变；这不是EOF。0字符但`has_more`的页也不表示结束，调用方应减少同批调用/路径，或由宿主增加预算，不能无限原样重试。

搜索保持原词法排名和扫描限制，按配额去掉尾部命中并标记截断；如果所有正命中都容纳不了，明确延后，不返回看似“无匹配”的结论。读取与搜索仍检查会话归属、SHA256及来源长度。

最终执行结果（包括验证拒绝和after hook改写）在发出toolResult前再次检查。违反配额的工具输出改成紧凑`TOOL_RESULT_BUDGET_EXCEEDED`错误，details只保留计数；保留usage和terminate语义。它无法撤销工具已经发生的副作用；因此这是合作工具的结果协议，不是任意工具副作用的事务系统。取消分支使用固定小错误结果。

PiMetricLab只在显式budgeted模式配置8KiB组预算，默认full模式不启用。恢复先从原assistant的**全部调用**与已绑定允许集合重算原分配，然后跳过已完成调用；若四次中已完成两次，剩余两次仍各2KiB，不各拿一个新8KiB池。指纹包含新版、组预算和工具元数据；旧任务不静默迁移。

边界：总额只覆盖已配置组的最终content数组，不包括外层ToolResult包装、details、partial updates、其他工具、assistant文本或完整下一轮上下文。它没有按下一轮可用空间预留输出，不提供token保证，最新回读批次保护与发送前硬上限照常执行。新的CPU对照和71项测试见[原始证据](../evidence/recall-budget/)，没有追加模型请求或宣称旧失败已解决。

## contextlab.10：响应返回后的纯回读空间规划

静态8KiB总额仍可能大于当前剩余空间。新增可选`ModelContextPolicy.planToolResultBudgets`：拿到本轮完整assistant后、任何工具执行前，允许策略根据实际参数和来源上下文**降低**宿主已有组预算；核心通过`restrictToolResultBudgets`拒绝提高上限、非法字节数及新增组，之后仍用原生分配/执行/最终检查路径。响应因length截断时直接沿用拒绝路径，不规划执行。

`BudgetedContextPolicy`只在`recallResultBudget: true`时启用。具体实现见[context-result-budget.ts](../vendor/pi-agent-core/src/context-result-budget.ts)：只处理全部为已选读取/字段定位工具的批次；混有业务工具或未知工具时保持原静态配额，因为这些结果大小不受该协议约束。

1. 捕获请求转换、规范化后的来源消息数组快照，追加实际assistant和每个调用的空结果，构成完整事务。不能直接保留一个会被流式回调追加assistant的活数组，否则投影可能重复调用、产生未配对事务。正常Agent和低层identity converter都有覆盖。
2. 设硬上限H、初始总分配D、调用数N；空content数组每个占2字节，另为通常时间戳/耗时等包装增量留256N字节余量。先尝试按`max(1024, H-D-256N+2N)`打包投影视图，使用同一查询、路由后工具、精确外置和完整旧轮规则，最新空回读批次仍保护。
3. 只有明确的`ContextPackingLimitError`才退回H再投影，存储错误、取消、损坏事务等直接抛出。得到投影大小P后，实际总配额是`min(D, H-P+2N-256N)`；若小于组内最低额，执行前终止。不会减少原assistant输入或伪造已完成结果。
4. 对正常内建回读，最终content按此配额分页，继续给实际offset。当前代码没有把投影替换成权威历史；它只用于准入和配额计算，下轮仍由正常policy重新准备并经过硬上限检查。

```ts
const policy = new BudgetedContextPolicy({
  ...policyOptions,
  recallResultBudget: true,
  onResultBudgetPlanned: async (input, budgets, trace) => {
    // 宿主在任何工具开始前，把方案与已保存的具体响应绑定。
    await saveResponseBoundPlan(input.assistantMessage, budgets, trace);
  },
});
const agent = new Agent({
  streamFn, initialState, modelContextPolicy: policy,
  toolResultBudgets: { 'context-recall': 8192 },
});
```

PiMetricLab在budgeted模式显式开启；full仍不启用。`result_budget_plans`以job和忽略thinkingLevel注释的assistant身份保存组配额，先验证持久请求/响应的工具绑定、再原子写方案与审计事件；已有方案不可修改。恢复先取此方案，再按原整批分配、跳过已完成结果。若中断发生在规划前，只用原assistant之前的来源重建，不把已经完成的部分回读误算成新空间。运行指纹升级，旧版本任务不静默迁移。

这不是任意后续请求的空间证明：256字节余量只面向通常内建回读包装，不约束任意hook的usage/元数据、自定义transform、后续工具集合变化或外部消息；混合批次仍静态。精确投影可能为较小目标写入artifact后失败，再走硬上限投影，这些幂等存储不能仅按最后packing trace声称精确写入次数。两个投影均不调用模型。保留下一轮硬上限、完整原文及错误状态，不提供token或模型成功保证。

新合成控制中静态版压力回读后拒绝，规划版以5,996字节回读生成23,660/24,576字节下一轮；空间充足时两版相同，无法容纳时新版工具开始数为0。80项工程控制、正常宿主持久化和重启复用见[完整证据](../evidence/result-headroom/)，未重试关闭的DeepSeek研究。

## contextlab.11：可行目标搜索和紧预算元数据

新的结构化业务预检（尚未调用模型）暴露core10的不足：期望8KiB回读对应的投影目标过小，退回硬上限时打包器刚放得下就停止外置，可能没有给最低内容和包装余量留空间。它会提前拒绝本可通过更多外置容纳的调用，不能仅用“未执行工具”说明目标已达成。

core11保持同样任务、20KiB上下文/8KiB静态组上限和评分，修复通用规划：期望目标失败后，先尝试`H-minimum-256N+2N`，这个回退也必须保证整批最低配额。若可行，在已知失败与已知成功目标之间最多二分16次，仅保留实际测量成功的投影；由最终P重算配额，不把上下文放到H再期待自己有余额。`projectionAttempts`记录目标、成功与字节，`usedFallbackSearch`和`selectedProjectionTargetBytes`解释最终选择。上界不足仍执行前拒绝，存储/取消/事务错误不被当作大小错误吞掉。不声称全局最优、token保证或任意插件下下一轮必然容纳。

紧预算读取先尝试完整旧格式；放不下才试`compact_metadata: true`。精确artifact_id、每路径text、returned_codepoints、next_offset、完整next_read及has_more都保留，仅省去重复的sha256、来源身份提醒、已知请求offset与total_codepoints；完整性仍在返回前验证，artifact_id本身含全hash。原文、参数及游标计算不改，ctx不能冒充ev的规则仍在工具声明里。若紧凑完整内容可放下就不截断；否则仍按code points限量，连空元数据都放不下则明确deferred。未配置字节预算时旧字段和序列化顺序保持原样。

原core10两个完整控制通过，两个预算控制在回读前拒绝；这些记录保留。core11四个控制均通过，预算实例各有两次pressure准备、两次原生回读与一次持久方案，最大视图20,438与20,390/20,480字节。它们是从当前provider视图读取事实、显式写assistant工作笔记的脚本，不是大模型准确率。85项工程测试及新独立CSV事实核对通过；真实API需先行发布固定源码后单独运行，见[前置证据](../evidence/structured-brief/)。
