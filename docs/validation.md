# 验证结果与适用边界

执行日期：2026-11-25。安装、编译、测试、原工作簿计算、浏览器和真实模型均在授权服务器执行；桌面只编辑源码、整理静态产物及 Git。未使用 GPU。

## 验证分层

| 层 | 方法 | 能支持的结论 |
|---|---|---|
| 业务与持久化 | Node 集成测试、独立人工可算夹具、真实 SIGKILL 子进程、HTTP 故障服务 | 指标边界、恢复、额度与 HTTP 工作流的工程正确性 |
| 完整真实数据 | 全部 541,909 行入库；独立 Python 直接读原始 Excel，用 Decimal/set 算结果 | 固定两个期间的六指标、国家分组与质量计数一致 |
| Pi 控制运行 | 真实 Pi 1.6 Agent，脚本化 provider 依次调用业务工具 | Pi 工具协议与应用闭环可运行；不证明模型能力 |
| 真实模型 | 官方 DeepSeek API、冻结问题/额度、保留全部失败 | 仅支持逐例集成观察；旧本地模型是已停止的历史记录 |
| 实际浏览器 | Chromium 操作工作台、导出、刷新与 390px 窄屏 | 检查页面交互和布局；没有代替人审核真实报告 |

## 框架与 DeepSeek 的实际结果

当前交付核心为 `1.6.0-contextlab.4`；四轮真实 API 研究均已关闭，不重试挑选更好的成绩。v3 在 v2 失败轨迹之后修复了批量 recall 中“一个错误路径丢掉全部有效字段”的行为，仅做工程回归，**v4 已得到负的任务效果结果，没有已证明的改善**。以下明确标出版本和不同问题，不能合并计算准确率。

### 工具选择：公开 ToolRet 子集

固定 [ToolRet-Queries](https://huggingface.co/datasets/mangopy/ToolRet-Queries) 的全部 101 条 API-Bank 查询，对 [ToolRet-Tools](https://huggingface.co/datasets/mangopy/ToolRet-Tools) 整个 web 目录 37,292 个工具检索。不是整个 ToolRet benchmark 分数。检索输入仅 query，不包含 instruction 或 positive labels。三个变体和预算在运行前冻结，固定 BM25 参数，不作标签调参。

| 变体 | Recall@10 | MRR@10 | 预算内平均 Recall | 平均 schema 字节 |
|---|---:|---:|---:|---:|
| 仅名称 | 0.99% | 0.0011 | 0.00% | 2,333.40 |
| 完整原始文档 | **30.94%** | **0.2082** | **25.99%** | 3,338.60 |
| 框架字段化文档 | 20.13% | 0.1231 | 18.32% | 2,869.61 |

**字段化方案没有胜过完整文档。** 文档中类别、接口等信息对检索可能有用；这是根据目录结构和负结果作出的解释，未做独立因果消融。当前支持 `routingDocuments` 传完整文档，但没有回跑标签宣称改进。

全流程 CPU 评测阶段 21.73 秒、采样峰值 RSS 约 805 MiB，无 GPU/模型请求。名称分词不拆 CamelCase、中文只用二元字符，词法方案对语义改写也有限制。运行时每次重新构建排名索引；离线复用索引的时间不能作为线上请求延迟保证。

[冻结方案](../examples/toolret-protocol.json) · [来源与文件哈希](../evidence/toolret/source-manifest.json) · [逐查询 ID、候选和分数](../evidence/toolret/results.json)。未重新分发原始查询/工具文档，数据来源许可仍应由复现者核对。

### 上下文对照：原版、整轮最近窗口、原生策略

模型均为官方 `deepseek-flash`、thinking disabled、内部重试 0；“输入 tokens”是该用例**全部实际请求累计**，含缓存输入。预算单位是规范化 JSON 字节，不是 token。各变体使用同一份初始历史，顺序在方案中冻结；没有独立重复、显著性检验或跨模型结论。工具发现/读取也是请求开销。

v1 使用十月/十一月净销售额报告，目标为报告 ID、变化金额与主要国家贡献：

| 用例 | 原版全历史：正确/输入 tokens | 最近窗口：正确/输入 tokens | 原生 v1：正确/输入 tokens |
|---|---|---|---|
| 大报告 | 是 / 5,615 | 否 / 1,491 | 否 / 2,968 |
| 报告后加 8 轮文档 | 是 / 7,600 | 否 / 5,523 | 否 / 14,156 |

v1 原生失败：第一例把 `ctx_` 存储身份当报告 ID；第二例对大对象连续分页，4 次请求后耗尽额度。压缩第一轮输入不能替代正确答案，也不保证总 token 降低。

v2 用新生成的八月/九月退货报告，目标为报告 ID、封存时间、comparison 结果哈希和退货变化，加入来源身份提示、按需工具及批量 JSON pointer：

| 用例 | 原版全历史：正确/输入 tokens | 最近窗口：正确/输入 tokens | 原生 v2：正确/输入 tokens |
|---|---|---|---|
| 新报告身份审计 | 否 / 17,319 | 否 / 1,586 | 否 / 8,505 |
| 新报告后加 8 轮文档 | 是 / 23,279 | 否 / 5,551 | 否 / 13,913 |

v2 原生两例仍失败。模型把占位符里的 `/source_identity/id` 当作原文路径，且读取整个 `/evidence` 导致重复分页。原版也出现凭空猜测 artifact ID，不能只展示其成功一例。v3 修复批量路径中的部分错误处理：完整性失败仍拒绝整次读取，单条缺失路径返回该路径错误，其他合法字段保留；不回改 v2 结果，也未追加付费重跑。

原版接收相同通用 utility schema，但没有外置 artifact；其错误调用保留。文档轮为 MIT 上游 README 的受控插入，不是真实用户长会话。最近窗口可能整体丢掉旧业务轮，失败不能推导所有最近窗口策略都无效。

v1 的语义评分接受等价 JSON 数字/金额字符串，原始仅字符串 grade 与后续离线 grade 均保留；没有发出新请求。v2 评分在新方案中预先固定。

[原 v1 方案](../examples/context-evaluation-protocol.json) · [v1 原记录](../evidence/api-v1/context-ablation.json) · [v1 离线评分及旧分数](../evidence/api-v1/context-ablation-graded.json) · [v2 方案](../examples/context-v2-protocol.json) · [v2 原记录](../evidence/api-v2/context-ablation.json)。原始 usage、调用参数、期望值、答案、逐轮字节与失败均在 JSON 中。

### 真正的业务调用

| 运行 | 月度调查 | 模糊问题 | 实际 API 请求 |
|---|---|---|---:|
| 原版 SDK 应用基线 | 十月/十一月净额报告完成 | 澄清完成 | 5 |
| 原生框架 v1 | 净额报告完成 | **失败：自行选了期间** | 6（另有 11 次上下文对照） |
| 原生框架 v2 | 八月/九月退货报告完成 | 澄清完成，无查询证据 | 5（另有 17 次上下文对照） |

v1 暴露了宿主缺少明确意图约束。现在创建任务时保存不可变 Comparison；没有该条件只注册检查/澄清，模型不能自建日期。比较、分组和封存核对相同意图，界面可显式填写条件。v2 退货金额基期 54,333.7500 GBP、本期 38,902.5500 GBP，变化 -15,431.2000 GBP。不是 v1 相同问题的重跑。

[原版业务记录](../evidence/deepseek-runtime-results.json) · [v1 业务记录](../evidence/api-v1/native-runtime.json) · [v2 业务记录](../evidence/api-v2/native-runtime.json) · [v2 总结](../evidence/api-v2/summary.json)。供应商 token 成本采用冻结单价估计，不是账单。控制器的 `model_calls:0` 是通用 CPU 外壳占位字段，不用于统计 API 请求；实际数量以 SQLite 导出的 calls 为准。

### 工程与浏览器

最初框架和宿主 25 个 Node 测试通过，包含原始 npm Agent 与 fork 执行集合对照、工具依赖/预算、原文完整性、整轮历史、恢复和意图约束。v3 部分路径错误回归也包含在同一测试集中。真实 SIGKILL 控制、受控 HTTP 故障与模型效果分别标注。

新版浏览器 14 项检查通过，包括原生策略记录、比较表单、完整数据、导出、刷新恢复和 390px 无横向溢出；无外部请求或 JS 页面错误，不对真实报告自动写人工审核。页面与全数据回归使用 v2；随后 v3 仅改读取工具的部分路径错误处理。

[最终测试 TAP](../evidence/final-tests.tap) · [浏览器原记录](../evidence/browser-result.json) · [服务器资源及冻结输入](../evidence/runs/)。所有已完成控制器结束时 owned 进程为 0。

## 完整数据交叉核对

期间预先固定为 2011-10-01 至 2011-11-01，以及 2011-11-01 至 2011-12-01，左闭右开、完整自然月。

| 指标 | 十月 | 十一月 |
|---|---:|---:|
| net_sales / GBP | 1,070,704.6700 | 1,461,756.2500 |
| gross_sales / GBP | 1,154,979.3000 | 1,509,496.3300 |
| returns / GBP | 84,274.6300 | 47,740.0800 |
| sales_orders | 2,040 | 2,769 |
| identified_customers | 1,364 | 1,664 |
| avg_order_value / GBP | 566.1663 | 545.1413 |

共核对 12 个指标结果、29 个国家分组的两期金额，以及总行数和五项质量计数。贡献按 Top N 与剩余分组核对总变化；不同 N 不改变合计。以上是 `retail-gbp-v1` 口径的结果，不是会计审计或现金流结果。

| 实测质量项目 | 行数 |
|---|---:|
| 总行数 | 541,909 |
| 客户 ID 缺失 | 135,080 |
| 描述缺失 | 1,454 |
| 价格非正 | 2,517 |
| 数量为负 | 10,624 |
| C 前缀取消单且数量非负 | 0 |
| 必填字段不合法 | 0 |

独立 oracle 的六项计数为总行数和缺失客户、缺失描述、非正价格、负数量、矛盾取消单；必填字段合法性由入库验证另行检查。

来源文件 SHA256：

- 原 ZIP：`f5385cbb54bbebf7196389109c6b0621faab0c304e3702548165e71c84aede8b`
- 原 Excel：`43465a06f2ccf7c8b5bd2892bc7defb52f97487934fe93b16ae4c3936424676d`
- 转换 CSV：`1f8144bb8670bcad07cde08205532fc6322d99e96c6ac8e8b5c979f169852065`

[原始工作簿独立计算结果](../evidence/uci-oracle.json) · [最终工程核对](../evidence/uci-validation.json) · [早期相同口径运行快照](../evidence/uci-validation-v1.json)。这些快照来自不同源码时间点，证据身份可能随稳定哈希实现变化，不能把旧报告 ID 当作新报告 ID。

## 工程测试覆盖

测试覆盖精确金额与舍入、零分母、字段注入、非法日期、部分月份、订单粒度、退款、未知客户、NULL 国家、OTHER、非可加指标拒绝、入库超精度拒绝；还覆盖证据 SQL 篡改、错期间/错指标、重复报告、版本审核、固定额度、未知尝试、旧 owner、配置变化、完成缓存、取消与停服恢复。

两种 SIGKILL 场景是真实进程中断：assistant 完整落盘后，以及查询/工具结果提交后。恢复后的控制调查仍只有四次 provider 请求和四次工具提交，没有把缓存命中包装成新的推理。

HTTP 503 用例使用真实 Pi OpenAI-compatible adapter 指向受控失败服务，确认关闭内部重试后只发出一次 HTTP 请求。它不属于真实模型效果测试。

## 已停止的早期本地模型历史（当前运行不使用）

模型：Qwen3-4B-Instruct-2507，固定 Q4_K_M，llama.cpp b12576；模型 SHA256 `9f1c9b5bd32d1c37502b525a677b3245a1b91fb7b71c7464f4264647998e7a06`。每次仅用两个 CPU 逻辑核，不分配 GPU。

第一次启动的总 RSS 上限 4 GiB 在权重加载期间被触发，峰值采样约 4.29 GiB；当时服务尚未 ready、没有任务账本、推理请求为零。停止后已确认没有遗留 owned 进程。随后在同一固定用例方案下将主机 RSS 上限调整为 8 GiB，其他问题与额度不变。

原方案有两个用例，总请求上限 7、单次输出分别 640/256、完整响应截止 90 秒。实际预留三次请求：

| 用例 | 实际预留 | 结果 |
|---|---:|---|
| 十月/十一月净销售额与国家贡献 | 1 | 90 秒中止，未形成报告 |
| “最近销售额是不是下降了？” | 2 | 完成 inspect_dataset；澄清工具参数输出中途超时，未执行不完整调用 |

**这两个用例均未完成，保持失败关闭，不复跑、不改记为成功。** 原始消息、账本与错误见 [真实模型结果](../evidence/real-model-results.json) 和 [运行元数据](../evidence/real-model-run.json)。没有报告不等于完成了业务调查；被截断的澄清意图也不能算成功澄清。

根据这个实际延迟问题，后续实现减少重复口径/溯源信息进入模型上下文，并支持显式配置且绑定任务的请求时限。另行冻结了一条不同的八月/九月退货金额调查，见 [独立集成方案](../examples/model-integration-protocol.json)。其结果单独记录，不与前两个用例混算通过率。

## 浏览器与界面

浏览器控制明确标注 `scripted-control`，不调用真实模型。验证全数据集显示、创建调查、两条证据、解释区与数字事实分离、审核表单、未审核状态、离线 SQL/哈希导出、刷新恢复、无 JS 异常、无外部请求以及 390px 无页面横向溢出。

首次 JSON 证据布局通过；改为面向分析人员的贡献表格后发现窄屏溢出，已修正网格子元素的最小宽度并重新检查。最终截图与记录放在 [images](images/) 和 [browser-result.json](../evidence/browser-result.json)。没有对真实报告写入自动化“人工通过”。

## 不能据此声称的成果

不能声称已有企业用户、生产 SLA、财务审计保证、并发吞吐、模型高准确率、因果发现、多租户安全或跨外部系统 exactly-once。完整数据验证也不是线上客户验收。CPU 真实演示是小样本集成检查，不能作为模型排名。

所有测试和运行的原始日志、失败控制器、资源上限和 SHA256 索引保留在本次工作记录。公开证据中的临时目录只用于追溯当次执行，实际部署应使用 README 的参数和自己的目录，不应复制临时服务器路径。

## 后续加固：请求绑定恢复

前版恢复代码扫描 `events()`，该方法只返回前 500 条；较旧或无关的策略记录可能被误用于待恢复响应。当前改为预留请求时保存工具集合、响应落盘时记录内容身份，恢复按该响应取集合；缓存复用同样校验集合。缺失或冲突绑定在执行和 provider admission 前暂停。该变化加入任务配置指纹，旧版任务不静默迁移。

验证使用同一份合成反例对冻结旧宿主与当前宿主运行：超过 500 条事件后，恢复一个只允许澄清的响应，虽然模型控制输入尝试比较，当前实现应拒绝查询、保持零查询证据。该反例也插入一个较新但无关的宽集合，证明不能仅把查询改成“最后一条事件”。结果和最终测试见 `evidence/request-binding/`。

新增控制还验证：缓存集合不同不复用；缺失响应绑定不执行；澄清事件位于第 500 条之后时恢复不再追加模型请求；任务快照显示最近事件，最新策略独立读取。无真实 API 调用，不改变已关闭模型研究结果。


实测结果：

| 同一合成反例 | 冻结旧宿主 | 当前宿主 |
|---|---:|---:|
| 事件总数 | 525 | 524 |
| 未允许的比较调用被拒绝 | 否 | 是 |
| 写入查询证据 | **1（错误执行）** | **0** |
| 最终状态 | failed（遗漏澄清） | clarification |
| 脚本 provider 请求 | 1 | 1 |
| 真实 API / GPU | 0 / 0 | 0 / 0 |

[修复前原记录](../evidence/request-binding/before.json) · [修复后原记录](../evidence/request-binding/after.json) · [源码身份](../evidence/request-binding/source-sha256.json)。两版来源均冻结；反例使用合成业务数据，不能作为模型能力或生产事故统计。

最终 **29 项 Node 测试通过**，其中含四项请求绑定/长事件恢复回归；全量 541,909 行、12 个指标值及 29 个国家分组重新核对通过；新版 14 项真实浏览器检查通过。测试阶段源码与最终源码逐文件核对一致；只有后续文档、证据和反例脚本说明发生整理。

[29 项测试 TAP](../evidence/request-binding/tests.tap) · [全量核对](../evidence/uci-validation.json) · [浏览器](../evidence/browser-result.json) · [资源、阶段结果及冻结协议](../evidence/request-binding/runs/)。服务器 owned 进程最终为零。

首次对照驱动错误假设旧版也会结束为 clarification，断言中止；旧版实际为 failed，正是遗漏后续澄清的另一表现。已保留[失败日志](../evidence/request-binding/initial-control-failure.log)和当次资源报告，修正驱动为分别核对旧版错误与新版预期，再在新目录运行。期间没有改应用源码、重跑已关闭 API 研究或产生真实模型请求。

## contextlab.4：数字原始字面与可选字段定位

新增 JSON 字段定位工具，按需与读取工具一起纳入预算；核心默认关闭；v4研究时客户端显式启用，研究后的普通入口也默认关闭。它定位原始 pointer 和有界值预览，不执行代码、不额外调用模型。字段扫描和返回都有上限；没有匹配不能证明字段不存在。

独立合成数值控制直接固定原始字符串与预期文本，再对冻结 contextlab.3 和新版工具读取：

| 读取 | 旧版 | contextlab.4 |
|---|---|---|
| `9007199254740993` | `9007199254740992` | 原始字面 |
| `0.1000000000000000001` | `0.1` | 原始字面 |
| 含 `1e999`、`-0` 的对象 | `null`、`0` | 原始数字字面 |

三项检查旧版 0/3、新版 3/3。它证明指定数值保真缺陷被修复，**不是模型成功率或所有 JSON 字节完全相同的结论**。源 artifact 的原字节仍由 SHA256 标识；容器字段回读规范化空白/字符串转义，并保留数字字面。未支持 JSON.parse source context 的运行时明确报错。

字段定位的 CPU 诊断使用固定提交 `02f69f7` 的真实 package-lock 和 GitHub 提交元数据，提前固定 8 条自编字段查询及目标 pointer；这是已知软件结构的诊断集，不是公开 benchmark 或未见过的泛化任务。query 进入排名，目标只用于 grader。输入完整性以来源 SHA256 核验。

| 变体/测量 | 结果 |
|---|---:|
| 仅路径 BM25 平均 Recall@10 | **75%** |
| 路径＋相邻标签＋值前缀 BM25 Recall@10 | 62.5% |
| 实际有界工具返回的平均目标覆盖 | 75% |
| 最大搜索 payload JSON 字节 | 3,934 / 8,192 |
| 结构扫描完整 | 8/8 |

组合表示没有胜过简单基线，保持负结果；不修改该诊断或重复运行挑分数。实际有界覆盖最多取 20 项，与 Recall@10 不是相同指标。结构完整不等于语义检索完整或字符串全文索引。随后完成了独立v4 DeepSeek研究，结果见后文；已有CPU诊断和v1/v2付费实验均不重跑。

[冻结诊断方案](../examples/field-location-cpu-protocol.json) · [逐例定位及数值对照](../evidence/artifact-search/results.json) · [来源身份](../evidence/artifact-search/source-manifest.json)。[完整诊断输入](../evidence/artifact-search/inputs/)来自本项目自身的公开 MIT 源码提交及锁文件，只含规范化 API data 对象，不包含认证头或私有 helper 状态；输入字节已冻结，可直接按 SHA256 核验。

最初新增诊断脚本的 TS 严格推断失败，尚未执行评分或模型请求；补充具体 Buffer/行类型后在新目录构建执行，保留[原类型错误](../evidence/artifact-search/initial-typecheck-failure.log)与当次资源记录。没有据此改动应用算法或重跑已评分诊断。


v4 最终服务器验证：**33 项测试、14 项浏览器检查通过**。完整 UCI 控制调查在 **16,384 字节的规范化上下文预算**下完成，独立核对 12 个指标值及 29 个国家分组；这里的 provider 是显式脚本控制，不是付费模型调用。旧请求绑定、两种真实 SIGKILL 和故障适配器控制仍通过。

[33 项测试](../evidence/artifact-search/tests.tap) · [实际源码身份](../evidence/artifact-search/source-sha256.json) · [严格预算全数据核对](../evidence/uci-validation.json) · [浏览器检查](../evidence/browser-result.json) · [资源及失败记录](../evidence/artifact-search/runs/)。最终 owned 进程为零，本轮模型调用及 GPU 均为零。

## v4 真实 DeepSeek 新报告对照

[方案先行发布在abd69e2](https://github.com/1137423918/PiContextLab/blob/abd69e28ee05773536b523def5008e90241b8369/docs/evaluation-v4-plan.md)，实际执行源码逐文件与该提交核对一致。35项CPU预检通过后，按冻结协议执行一次，实际23次请求：业务5次、审计18次，上限33。全部执行已关闭，owned进程为零，不追加质量重试。

新六月/七月gross_sales报告3次请求完成；新的中文模糊退货问题2次进入clarification，未写查询证据。报告通过指定比较期间、country Top5及证据哈希校验后才开始审计，没有使用旧报告。新报告金额为761,739.9000→719,221.1910 GBP；这里是确定性工具结果，不表示新期间已另做一套独立会计核对。

六项溯源字段审计结果：

| 条件 | 完整上下文：正确/请求/输入tokens | 原生回读：正确/请求/输入tokens | 原生回读＋字段定位：正确/请求/输入tokens |
|---|---|---|---|
| 新报告 | 是 / 1 / 5,116 | 否 / 4 / 11,585 | 否 / 4 / 12,402 |
| 新报告后加六轮资料 | 是 / 1 / 6,891 | 否 / 4 / 14,587 | 否 / 4 / 14,832 |

两种原生分支均0/2，完整上下文2/2。累计输入包括缓存与全部轮次：full12,007、read26,172、search27,234。这里full允许64KiB、原生限制16KiB，测试的是把大历史放入较小预算的代价，不能据此断言Pi原版在所有任务更强。两个条件共享一个报告与六个目标，也不是独立随机任务。

模型在字段定位分支中**没有调用search_context_artifact**，两例仍只调用读取工具，共7次；read分支8次。四个原生条件中三个耗尽固定额度，另一例输出五个正确字段与`breakdown_result_sha256:null`，按预定完整性标准未通过。返回null与胡编校验和不同，但仍没有完成任务。

原始工具记录显示，四个原生分支的第二页都包含目标校验和，随后仍重复分页。较旧的回读页在后续准备中再次被外置；这些行为共同出现，没有独立消融证明单一原因。批量读取共享limit使第一批`/evidence`实际返回4,069而非4,096个codepoints，有些后续offset产生27字符空隙；有一例使用重叠分页仍失败，空隙不是唯一解释。准备记录可能多于实际请求，额度拒绝也可发生在prepare之后；实际请求数以账本和wire记录为准。

总估计费用约$0.0206，按冻结单价计算，**不是供应商账单**。prefix缓存与固定顺序影响费用，不能由这个小样本外推成本倍数。旧v1/v2和本次的字段、报告、工具基线设置不同，不画版本成功率提升曲线。

[业务原记录](../evidence/api-v4/native-runtime.json) · [审计原记录](../evidence/api-v4/context-ablation.json) · [完整消息与请求绑定](../evidence/api-v4/audit-transcripts.json) · [逐例汇总](../evidence/api-v4/summary.json) · [离线分析](../evidence/api-v4/analysis.json) · [冻结源码身份](../evidence/api-v4/source-sha256.json) · [真实未审核报告](../examples/deepseek-v4-gross-sales-report.html)。

研究结束后，CLI、真实API入口及Runner默认改为完整上下文；预算策略与字段定位需显式开启。没有为这个默认值调整追加模型请求，也没有修改原研究的分数或源文件。发布控制为**37项Node测试＋14项浏览器检查**，另通过显式budgeted模式下16KiB的全量数据控制；完整上下文业务路径和显式预算恢复都覆盖。

[37项发布测试](../evidence/api-v4/release-tests.tap) · [发布源码身份](../evidence/api-v4/release-source-sha256.json) · [35项运行前检查](../evidence/api-v4/preflight-tests.tap) · [阶段和资源](../evidence/api-v4/runs/)。实验前的首次类型检查在发送模型请求前失败，修正输出目录的类型收窄后通过并先行提交；[失败日志](../evidence/api-v4/initial-typecheck-failure.log)保留。


## contextlab.5：按压力外置和续读的 CPU 控制

基于旧轨迹中的分页与外置行为，提前固定三组新的合成输入，对冻结 core4 与 core5 使用相同消息；旧 baseline 的 context-budget.ts 与公开 fc2d13c 提交逐字节核对。只测程序机制，不追加真实模型请求。

| 新合成场景 | core4 artifact 写入 | core5 写入 | core5 精确保留 |
|---|---:|---:|---|
| 11,656 JSON 字节已在 16KiB 内 | 1 | 0 | 整条结果 |
| 16,384 字节需压至 10,000 内 | 2 | 1 | 较小普通结果，最终4,914字节 |
| 普通结果＋最新两个并行回读 | 2 | 1 | 两条回读，最终12,292/16,384字节 |

第一例 core5 保留了更多字节，正是避免不必要外置；这里不追求压缩比例最高。第三例 core4 只保留最后一条回读，新版共同保护两条。三例不是泛化 benchmark，不含真实模型推理，不能用来推断成功率、累计 token 或费用改善。

另外的 Unicode 控制中，同次共享 limit=11，第一项用3个 code points，第二项返回8个；第二项 next_read 从8继续，多页拼接与原值相同。覆盖共享剩余额度为0、越界整数拒绝、单字段续读及末页 null。路由控制还验证未选择 schema 与显示 details 不会触发虚假压力，历史超限仍按完整旧轮归档。

服务器通过 **44 项测试、14 项浏览器检查**；541,909 行全量数据在显式 budgeted/16KiB 的脚本 provider 下完成，继续独立核对12个指标值、29个国家分组及质量计数。执行约46秒，owned 进程最终0，新增模型请求0、GPU0。旧真实 DeepSeek 负结果不变；普通入口继续默认完整上下文。

[方案](../examples/pressure-policy-cpu-protocol.json) · [逐例结果与输入源码](../evidence/context-pressure/) · [44项测试](../evidence/context-pressure/tests.tap) · [源码身份](../evidence/context-pressure/source-sha256.json) · [全量核对](../evidence/context-pressure/uci-validation.json) · [浏览器](../evidence/context-pressure/browser-result.json) · [资源与两次类型错误](../evidence/context-pressure/runs/)。类型错误均发生在诊断运行之前，修复后使用全新目录，未改预期或重跑已评分数据。


## contextlab.6：真实工具目录上的索引复用开销

新方案只使用固定 ToolRet web 目录的37,292条元数据，不加载原101条检索查询或标签进行评分。用八条新的通用查询、每变体两轮，首轮旧版在前、次轮缓存版在前；缓存第一次调用冷启动也纳入结果。被测为相同路由逻辑与完整字段文档，基线为3cda10c的冻结core5，不重新评价旧质量分数。

目录中1,210条参数描述为list、1条为string。第一次驱动在开始任何计时前因对象断言中止；修正边界适配，将这1,211条保留在惰性对象schema的`x-catalog-parameters`字段，检索文档仍使用原始参数。没有删除行、改变query或缓存额度。全部37,292条保持在负载中，但这里不是可直接执行的API目录。

| 固定CPU负载 | 每次重建的core5 | 有界复用的core6 |
|---|---:|---:|
| 实际路由调用 | 16 | 16（含1次冷启动） |
| 中位 wall ms | 991.1 | 433.3 |
| 样本p95 wall ms | 1,171.0 | 1,022.8 |
| 路由总wall ms | 16,280.0 | 7,716.6 |
| 与配对变体全部排名/分数/schema成本/选集相等 | 16/16 | 16/16 |

缓存构建1次、命中15次，未淘汰/旁路，保留源字节26,306,261；benchmark阶段进程树峰值RSS约689MB，包含两变体与负载，不是缓存单独占用或堆内存上限。每次命中仍扫描序列化元数据；该结果是单台受限CPU服务器、固定工作负载的观察，不是生产SLA、端到端Agent速度、统计泛化或准确率提升。所有样本、冷启动及顺序均保留，没有按速度阈值挑结果。

另通过51项工程测试，包含就地修改失效、当前执行对象身份、预算/依赖重算、LRU和源字节旁路，以及原有协议、恢复和业务边界。完整UCI的541,909行/12指标/29国家核对及14项浏览器检查通过；脚本provider显式验证16KiB预算模式，不冒充真实大模型。最终owned进程0，新增模型请求0、GPU0。默认真实入口仍为完整上下文。

[运行前方案](../examples/routing-cache-cpu-protocol.json) · [逐调用结果及冻结源码](../evidence/routing-cache/) · [51项测试](../evidence/routing-cache/tests.tap) · [执行源码身份](../evidence/routing-cache/source-sha256.json) · [资源和失败记录](../evidence/routing-cache/runs/)。首次严格类型检查也曾在计时前因驱动数组类型失败；原日志与上面的目录边界失败均保留。修正后在新目录只执行一次有效性能对照。


## core6 新业务任务：运行前预检

[运行前方案](evaluation-business-v6-plan.md)和[机器协议](../examples/business-v6-protocol.json)在付费请求前冻结。两个新范围分别为四月/五月returns-country和二月两个14天窗口net_sales-stock_code；完整64KiB与预算16KiB各一次，上限24请求，字段搜索关闭，不重新评价旧研究。

服务器无密钥预检通过52项Node测试、14项浏览器检查与原全量UCI核对。新Python CSV/Decimal oracle包含31个国家分组、2,417个商品分组，预检同DuckDB核对Top/OTHER与总额（全部保存行另在研究后核对）；对应退货金额44,601.5000→47,202.5100 GBP，净额229,796.4900→268,266.1600 GBP。这是独立算术控制，不是模型成功。

新的源码归档控制验证必要fixture、排除私有/生成/旧archive、逐文件hash、相同输入字节一致及symlink拒绝。预检输入包512,820字节，含118个清单文件，不再嵌套历史实验包。已有冻结包保持不变。

[52项预检](../evidence/business-v6/preflight-tests.tap) · [独立oracle](../evidence/business-v6/oracle.json) · [逐组核对](../evidence/business-v6/oracle-validation.json) · [源码归档控制](../evidence/business-v6/source-snapshot-checks.log) · [输入清单](../evidence/business-v6/snapshot-manifest.json) · [资源](../evidence/business-v6/runs/)。原预检提交68cf51f当时尚未发出本研究真实请求；随后结果单独留存。原预检把核对范围写宽，当前已更正，冻结方案附有运行后说明。


## core6 两个新业务任务的真实 DeepSeek 结果

[先行提交68cf51f](https://github.com/1137423918/PiContextLab/commit/68cf51fbbbd9b8d7c5d3dff9c848d0651344ca51)在发请求前公开，执行的69个源码文件与该提交核对一致。独立新研究按原协议只运行一次：四个任务实例总计12次真实请求/12次持久预留，低于24上限，无缺失usage；研究已关闭，owned进程最终0。

| 新任务 | 配置 | 原定评分 | 请求 | 累计输入tokens（含cache） | 累计输出tokens |
|---|---|---|---:|---:|---:|
| 四月/五月returns，country Top8 | 完整64KiB | 通过 | 3 | 5,421 | 851 |
| 同任务 | 预算16KiB | 通过 | 3 | 5,424 | 981 |
| 二月等长半月net_sales，stock_code Top12 | 预算16KiB | 通过 | 3 | 5,602 | 1,217 |
| 同任务 | 完整64KiB | 通过 | 3 | 5,602 | 1,200 |

四个实例均按inspect→compare→breakdown→submit调用工具并封存报告，通过原定请求、来源身份、Top/OTHER金额和总额检查。输出是多次请求的合计，不是单次1,024上限被突破。预算实例的最大规范化视图分别10,633与11,035字节，**均未触发外置、历史归档或回读**；每个policy索引构建1次、命中2次。

因此这只补充低压力真实业务集成证据：新版在这些普通任务中可以保留全部结果并完成流程。不是上下文压力效果实验，没有证明旧v4失败被修复、成功率更高或更省token。两个新任务分别复用相同数据源，两种预算不同，不能作为泛化准确率或新旧版本效果曲线。原v4审计负结果保持不变，默认真实入口仍为完整上下文。

原评分的`groups_checked`表示参与Top/OTHER验证的oracle组数，**不是完整SQL行逐条对账数**；预检的原说明写宽，已明确更正。模型研究结束后，另加独立CPU审计，对保留的每个原始SQL分组/期间行按相同CSV Decimal oracle逐条核对：每个returns实例31组、每个商品实例2,417组。错误金额、缺组和重复行反例拒绝；原评分代码和分数未改，不追加模型请求。这是事后算术完整性核查，应与先验任务评分区分。

总估计费用约$0.0067，按冻结单价和全部usage计算，**不是供应商账单**；前缀缓存、固定顺序及不同输出长度影响费用，不推导省钱比例。报告叙述与因果假设没有评分，仍未经人工审核。

[原始任务/消息/证据](../evidence/business-v6/results.json) · [逐例汇总](../evidence/business-v6/summary.json) · [Pi provider边界输入](../evidence/business-v6/wire-transcripts.json) · [执行源码身份](../evidence/business-v6/source-sha256.json) · [全部分组行补查](../evidence/business-v6/raw-group-audit.json) · [新退货报告](../evidence/business-v6/reports/returns-april-may-country.html) · [新商品报告](../evidence/business-v6/reports/net-sales-feb-halves-products.html) · [资源](../evidence/business-v6/runs/)。所谓wire记录是传给Pi适配器的context，不是原始HTTP body；API适配器还会按自身协议转换。


## contextlab.7：累计中等结果的真实数据控制

新[月度复盘方案](evaluation-pressure-business-plan.md)固定三月/四月三指标、国家/商品六个分解，共九份证据；完整64KiB与预算24KiB，未改变案例或评分去调结果。[任务等价核对](../evidence/pressure-business/task-equivalence.json)留存旧新协议及输入hash。第一次驱动的类型错误先修正，再取得core6真实数据控制；当时没有发模型请求。

core6完整分支完成，但预算分支在第四次脚本provider调用前拒绝。10条结果（含inspect）最大仅1,913内容JSON字节，均不超过4,096单条阈值；总视图仍超预算，没有旧轮可归档。这暴露通用候选门槛限制，不是DeepSeek效果失败。

core7只修复压力模式的候选过滤：按大小优先、净节省才替换，必要时包含低于单条阈值的普通结果；无压力零写入，保护最近回读批次，显式threshold保留旧门槛。新增belowThresholdSpills与候选循环取消检查。独立中等结果/兼容模式回归通过。

| 同一显式脚本控制 | core6 | core7 |
|---|---|---|
| 完整分支 | 完成，4次脚本调用 | 完成，4次脚本调用 |
| 预算分支 | 3次后拒绝，无报告 | 完成，4次脚本调用 |
| 新版预算实际pressure/外置 | — | 1次准备 / 2条结果 |
| 新版预算最大视图 | — | 24,564 / 24,576字节 |
| 新版报告独立原始组核对 | — | 每报告8,544组次（跨指标/维度重复计数） |

这8,544是六个组成部分的组检查数，不是独立样本或订单数。脚本提交只从provider视图中的id/source_identity.id取九个来源身份，未绕过上下文从Store取答案。它证明程序可行性和精确来源保留，不是模型质量结果。

服务器通过56项Node测试、14项浏览器检查、完整UCI核对；owned进程0，GPU0。先行提交1c386e7当时尚未发付费请求；随后按固定16请求上限执行一次，原始结果见后文，失败保留。[56项测试](../evidence/pressure-business/preflight-tests.tap) · [失败根因的结果大小](../evidence/pressure-business/preflight-cause.json) · [旧控制](../evidence/pressure-business/controls/core6/) · [新控制](../evidence/pressure-business/controls/core7/) · [独立oracle](../evidence/pressure-business/oracle.json) · [阶段/资源/类型错误](../evidence/pressure-business/runs/)。既有关闭研究未重跑。


## core7 多指标压力业务的真实模型结果

[先行提交1c386e7](https://github.com/1137423918/PiContextLab/commit/1c386e795ff43745c8880e63ae818e5266998764)公开后执行一次：实际10次DeepSeek请求/10次持久预留，低于16上限，无缺失usage；已关闭，不追加质量重试。128个实际执行输入文件逐一与先行提交核对一致。

| 同一工作流的配置 | 原定评分 | 请求 | 累计输入tokens（含cache） | 累计输出tokens | 最终状态 |
|---|---|---:|---:|---:|---|
| 完整64KiB | 未通过 | 6 | 36,076 | 5,376 | 发送前字节上限拒绝 |
| 预算24KiB | 未通过 | 4 | 12,152 | 1,781 | 当前轮在外置后仍超限 |

两个分支都获得九份查询证据，但均未封存报告，因此按预定规则均失败。完整分支三次submit的interpretation分别3,348、3,019、3,006个字符，均超过schema的3,000限制；错误反馈包含完整收到的参数，三条内容JSON分别5,506、5,073、5,060字节，随后触及64KiB发送前上限。模型逐次缩短但仍未满足限制，不能放宽schema或补一次请求来改成成功。

预算分支在成功准备记录中触发pressure，记录四条原本低于4KiB阈值结果的外置、四个不同artifact，最大成功准备视图23,655字节。失败准备的中间写入不在此计数中，不能把它读成精确artifact写次数。随后模型同批调用四个精确读取，取/result内容，合计返回5,013个code points；四条响应内容JSON合计9,821字节。最近回读批次按原协议保护，后续准备因当前轮仍超24KiB而拒绝，没有发出第五次模型请求。这里观察到返回预留与并行回读的限制，没有独立消融证明某个因素是唯一原因。

因此，core7累计中等结果的程序缺陷已在CPU控制中修复，实际模型也使用了四次该类外置；**真实任务完成仍未成立**。脚本只需要来源ID，模型为叙述又读取结果，二者行为不同。不能用脚本通过代替模型成功，更不能由失败任务少用token推导成本收益。不同预算、单一工作流及固定顺序也不支持泛化准确率结论。

总冻结单价估计约$0.0132，不是供应商账单。owned进程最终0，GPU0。默认真实入口仍为完整上下文。后续可研究有界schema错误反馈、请求前输出空间预留与跨并行读取的总响应预算；这些尚未实现或被模型验证，不写作成果，也不以本任务重试挑分。

[逐配置汇总](../evidence/pressure-business/summary.json) · [完整压缩原记录](../evidence/pressure-business/results.json.gz) · [Pi边界输入](../evidence/pressure-business/wire-transcripts.json.gz) · [外置与调用分析](../evidence/pressure-business/analysis.json) · [离线错误诊断](../evidence/pressure-business/failure-analysis.json) · [执行源码](../evidence/pressure-business/source-sha256.json) · [128文件提交核对](../evidence/pressure-business/commit-verification.json) · [资源](../evidence/pressure-business/runs/)。gzip格式只压缩保存字节，不改原始JSON内容；Pi边界输入不是原始HTTP body，费用不作账单陈述。
