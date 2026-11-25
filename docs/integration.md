# 独立 SDK 接入与运行说明

PiContextLab 的派生核心可以在领域宿主之外使用。本说明围绕固定 `1.6.0-contextlab.12`，不代表上游 Pi 最新版。安装产物、源码映射、许可和独立消费结果见[分发证据](../evidence/sdk-distribution/)；根仓库的经营应用另按[README](../README.md#运行)启动。

## 从空目录验证接入

在服务器准备 Node 22.19+。将本仓库的 `examples/sdk-consumer/` 文件复制到一个**不位于本仓库内部**的新目录，并把已核验的核心 tarball 命名为该目录内的 `core-package.tgz`。例如：

```bash
mkdir /path/to/new-sdk-consumer
cp examples/sdk-consumer/* /path/to/new-sdk-consumer/
cp evidence/sdk-distribution/earendil-works-pi-agent-core-1.6.0-contextlab.12.tgz /path/to/new-sdk-consumer/core-package.tgz
cd /path/to/new-sdk-consumer
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/typescript/bin/tsc -p tsconfig.json
node dist/smoke.js
```

先对照[分发清单](../evidence/sdk-distribution/distribution.json)的 SHA256。包名沿用依赖兼容所需的 `@earendil-works/pi-agent-core`，版本和说明明确标注非官方派生；没有将它发布到上游 npm 账号。tarball 保留 MIT 原许可、上游固定提交、JavaScript、声明、映射及映射所需的源码。

`smoke.ts` 是合成包边界控制：运行真正的 Pi Agent、生成脚本响应、触发外置与精确回读，再检查原始历史、数值字面、声明/选集和上下文上限。它不调用 HTTP 模型，不是客户案例或模型效果实验。`skipLibCheck=false`，既检查示例也检查其依赖声明；实际测试目录位于仓库外，安装的是 tarball 解包，不能借用仓库的 `node_modules` 或 `src/runtime.ts`。

`package.json` 将 Pi AI/schema 固定在1.6.0；独立消费验证保存其实际 lock。将示例迁入自己的工程时应保留冻结依赖、重新检查版本与产物身份，不自动换成 upstream main 的 API。

## 接入自己的 Agent

[agent.ts](../examples/sdk-consumer/agent.ts)导出 `createContextManagedAgent(options)`。它接受调用方提供的 `model`、`streamFn`、工具注册表、来源存储和预算，返回真实 `Agent` 与本次独占的 `BudgetedContextPolicy`。工厂本身不发模型请求。

| 输入 | 调用方需要确定的事 |
|---|---|
| `model` / `streamFn` | 模型身份、供应商适配器、密钥、完整流超时、重试与调用额度。真实项目参考[DeepSeek宿主](../src/runtime.ts)，密钥不进入网页、模型配置或版本库 |
| `tools` | 严格参数 schema、实际执行函数及业务约束；工具应完成权限、数据版本、期间和金额检查 |
| `artifacts` | `put/get`按任务隔离，原文不可变；存储身份和校验哈希不是用户授权机制 |
| `maxContextBytes` | 规范化 provider 上下文 JSON 字节上限，包含工具声明；不是 tokenizer 上限 |
| `maxTools` / `maxSchemaBytes` | 工具数量及声明预算，必须给必选组、依赖闭包和必要回读工具留下空间 |
| `alwaysInclude` / `dependencies` | 真实注册名称与完整依赖；超预算时拒绝，不能偷偷丢一半依赖 |
| `exactResultRetention` | 默认false；开启后只在已有外置视图的剩余空间放入有界完整来源子树，不保证正好留下全部答案 |

一轮先由策略生成规范化 provider 视图及执行集合，再由核心核对两者一致；模型完整返回后才验证和执行工具。不要在工具流式参数尚未结束时自行执行，也不要另写一个循环绕过原生 Agent 的执行检查。

本工厂明确启用2KiB校验反馈、8KiB共享回读内容预算及响应后的纯回读规划。它们保留字段诊断、精确分页和发送前上限，仍不保证任意混合工具输出、变换或自定义 hook 都能容纳下一轮。最新回读批次受保护时，空间不够可能直接拒绝；缩短第一页不是等量信息压缩。

## 接回持久宿主

核心的内存Agent、`replay:'safe'`、`steer`/`followUp`都不自动提供可靠队列、持久额度或第三方副作用 exactly-once。合成控制使用内存来源表，只适合演示接口；实际项目按现有[Runner](../src/runtime.ts)、[Store](../src/store.ts)的边界接回宿主：

1. 同一任务取得owner/epoch写入权，运行期间续租；其他任务/旧写入者不能提交。
2. 在`onPrepared`记录本轮选择，发送前先预留固定额度并绑定声明/执行集合。超时或未知请求也占原额度，不因为没有usage就自动补一次。
3. 等待`message_end`持久化完整assistant消息，随后才允许执行工具。把证据与可重放工具结果一起提交。
4. `onResultBudgetPlanned`须在工具开始前保存与具体assistant响应绑定的方案；恢复复用原批次，不按剩余调用重新分配。恢复路径仍用Pi的`runToolCall`及同一允许集合。
5. 将策略版本、工具元数据、模型、预算和应用约束纳入指纹；已有任务配置不一致时要求新任务，不能静默切换语义。

这些是宿主承担的工作。SDK工厂仅暴露回调，不宣称示例内存表已实现上述恢复。普通报告中的来源身份、结构化声明核对和人的审核也需分别保存，不能让Agent自行勾选人工通过。

## 使用既有经营应用

按根README准备来源明确的CSV并入库。真实运行时在后端配置 `DEEPSEEK_API_KEY`、`METRICLAB_MODEL_URL=https://api.deepseek.com`、`METRICLAB_MODEL_ID=deepseek-flash`；当前默认完整上下文、字段定位及精确保留关闭。预算实验需要显式选择`METRICLAB_CONTEXT_POLICY=budgeted`；单独打开保留标志或非法枚举会拒绝。

没有密钥时可以使用检查模式，或显式用`--scripted-control`验证工程流程；界面会标注它不是真实推理。研究原始报告和JSON也可离线阅读，无需重新支付模型调用。

服务绑定服务器的127.0.0.1。需要从自己的电脑访问时，可通过已有SSH连接转发本地端口，例如 `ssh -L 4318:127.0.0.1:4318 USER@HOST`，再打开本机4318端口。当前范围是可信单租户工作台，不能把这个步骤当作公网鉴权或多租户部署。

## 复现范围与排错

| 现象 | 依据与处理 |
|---|---|
| 包安装后类型或源码跳转缺文件 | 核对tarball及`distribution.json`，确认声明映射引用的`src/`随包存在；不要改从本仓库相对路径导入来掩盖分发缺失 |
| 数值回读运行时不支持source context | 使用已声明Node版本并执行能力检查；不能用Number重新序列化代替精确字面 |
| Required tool/dependency group exceeds budget | 检查必选工具、依赖闭包及回读声明占用；这是显式拒绝，不能把未声明工具放回执行集合 |
| 当前轮超出预算 | 参考trace的规范化字节、spill与保护批次；不静默截断system、当前问题或未完成工具事务 |
| 任务已暂停或提示配置改变 | 先检查状态、配额和指纹。已关闭研究不重开；新配置使用独立新任务，原未知请求和失败保留 |
| 界面没有模型任务入口 | 核对运行模式及后端provider配置，密钥不填入网页或浏览器脚本 |

工程与SDK控制可用于个人独立复现；已关闭研究不在自动任务中重跑、改预算或挑最好结果。117次真实生成请求是不同工作负载的累计执行数，不是同一准确率基准。新的效果研究仍需独立任务和事前固定的方案。
