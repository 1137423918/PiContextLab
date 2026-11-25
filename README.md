# PiContextLab

**Pi Agent Core 的上下文预算与工具选择改造**，使用 DeepSeek API 运行；附带可追溯经营指标调查客户端 PiMetricLab，用真实数据验证框架行为。

这项项目的主体是对固定 **Pi 1.6.0** 核心的 MIT 派生实现 `1.6.0-contextlab.4`，不是只换 prompt 或套 SDK。原始版本以独立 npm 别名保留作对照；尚未向上游提交或合入。

[完整中文讲解](docs/handbook.md) · [框架改动与算法](docs/framework.md) · [实验结果](docs/validation.md) · [DeepSeek 接入](docs/deepseek.md) · [简历与面试](docs/resume.md) · [研究来源](docs/references.md)

## 核心改进

| 改动 | 实际行为 |
|---|---|
| 原生 `ModelContextPolicy` | 在规范化 transcript 后生成本轮 provider 视图及执行白名单；核心验证声明与注册工具对象一致 |
| 预算化工具选择 | BM25 词法排名、依赖闭包、工具数量/schema 字节双预算；显式发现漏选工具；支持完整目录文档 |
| 可回查上下文 | 大结果按 SHA256 外置，保留来源身份；完整旧 user turn 按相关性/大小和新近性打包；权威消息不裁剪 |
| 字段定位 | 可选的有界 JSON 叶字段词法检索，返回合法 pointer 与来源预览；无额外模型调用 |
| 批量精确 recall | 会话范围、完整性检查、最多 8 个 RFC6901 路径、总计最多 4,096 Unicode code points |
| 请求审计与恢复 | 宿主将工具集合与请求预留、具体响应身份绑定；恢复按该响应查集合，未知调用仍占额度 |

上游已有压缩、持久化 Harness 和工具执行能力。本项目的贡献是 core 层的策略入口、预算组合及声明/执行一致性；BM25、哈希外置和持久化思想均不声称原创。

## 真实验证客户端

PiMetricLab 完成“订单明细 → 明确口径 → 期间比较 → 国家/商品贡献 → SQL 证据 → 封存报告”。支持六种指标，使用 DuckDB DECIMAL 和 BigInt；没有任意 SQL、shell 或审核工具。未明确指标/期间时仅暴露检查与澄清工具，避免模型自行猜测。

完整 [UCI Online Retail](https://archive.ics.uci.edu/dataset/352/online+retail) **541,909 行**入库，直接从原 Excel 读取的独立 Decimal/set 程序核对 **12 个指标值、29 个国家分组及质量计数**。数据属 Daqing Chen (2015)，[DOI](https://doi.org/10.24432/C5BW33)，CC BY 4.0；原始数据不入库 Git。

![框架策略验证工作台](docs/images/investigation-desktop.png)

## 运行

Node **22.19+**（实测 22.23.5）。本次所有安装、构建、测试、浏览器和推理均在授权服务器执行，未使用 GPU。

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run build
npm test
```

显式下载 [原始 ZIP](https://archive.ics.uci.edu/static/public/352/online+retail.zip)，在独立 Python 环境安装 `openpyxl==3.1.5`、`et-xmlfile==2.0.0`：

```bash
python scripts/prepare_uci.py --archive /path/to/online-retail.zip --output /path/to/retail-data
node dist/src/cli.js ingest /path/to/retail-data/transactions.csv /path/to/retail-data/source-manifest.json
export DEEPSEEK_API_KEY='YOUR_KEY'
export METRICLAB_MODEL_URL=https://api.deepseek.com
export METRICLAB_MODEL_ID=deepseek-flash
export METRICLAB_MAX_CONTEXT_BYTES=65536
export METRICLAB_CONTEXT_POLICY=upstream
export METRICLAB_ARTIFACT_SEARCH=0
npm start
```

打开 `http://127.0.0.1:4318`，在“明确比较条件”里选择指标及四个边界日期。例如净销售额：基期 `[2011-10-01,2011-11-01)`，本期 `[2011-11-01,2011-12-01)`，完整自然月；问题填写“比较以上期间，按 country 拆解变化并提交报告”。不填条件时先澄清。CLI 也可使用四个 ISO 日期、准确指标 token 及 `calendar_month`/`equal_days` 的显式问题。

真实 API 入口默认使用完整上下文，超过配置上限时在发送前拒绝。预算化策略与字段定位需要显式开启，配置见 [DeepSeek 接入](docs/deepseek.md)。

Pi 运行时直接调用官方 DeepSeek API，显式关闭 thinking、内部自动重试为 0，无需显卡或本地权重。未配密钥时为检查模式。无需推理的工程演示：

```bash
node dist/src/cli.js serve --scripted-control
```

页面明确标注 `scripted-control`，固定十月/十一月调查，不代表模型效果。

## 如何看结果

最新宿主通过 **37 项工程测试、14 项浏览器检查和全量数据核对**。修复了超过 500 条事件后可能用错恢复工具集合的问题；同一合成反例中，未允许的查询证据由修复前 1 条变为修复后 0 条，见 [恢复对照](evidence/request-binding/)。

公开 ToolRet API-Bank 的 101 条查询对 37,292 个工具检索中，字段化词法方案 Recall@10 **20.13%**，低于完整文档基线 **30.94%**。早期上下文方案也出现把存储 ID 当报告 ID、过多分页而耗尽额度的失败。原始结果保留，后续修订使用新用例单独记录，不能把字节减少写成成功率提升。

v4 新报告的真实 DeepSeek 审计中，完整上下文2/2通过，两种预算策略均0/2；因此它们保持实验性。研究已关闭，不重复挑分，见 [运行前方案](docs/evaluation-v4-plan.md)及 [完整原记录](evidence/api-v4/)。

[实验记录](docs/validation.md) 区分工程控制、公开检索、真实 API 小样本和独立金额核对。当前不声称 SOTA、新模型训练、生产用户、普遍准确率提升或无损完成所有任务。

当前为可信本机/内网的单租户工作台，不提供公网鉴权或多租户隔离。报告解释标记待核实，贡献分析不证明因果。个人主页保持冻结。

项目采用 MIT；派生核心保留 [上游来源与文件哈希](vendor/pi-agent-core/UPSTREAM.json)、[原许可](vendor/pi-agent-core/LICENSE) 和 [可移植源码补丁](patches/)。精确依赖见 [package-lock.json](package-lock.json)。
