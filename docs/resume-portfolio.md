# 当前项目总表与简历组合

更新于2026-11-25。PiContextLab新加入此前的项目材料；旧Agent Reliability Lab中的不同模块仍归于同一Lab，不包装成多个商业产品。两类岗位的[单页项目经历附件](../examples/role-briefs/)使用同一份可编辑正文和来源绑定，包含第一作者论文及一条正式提交的开源贡献，不补造教育或实习经历。

## 推荐组合

| 优先级 | 项目/模块 | 适合岗位 | 可以讲清的成果 | 当前边界 |
|---|---|---|---|---|
| 主项目 | PiContextLab框架改造与经营验证 | 算法工程、Agent框架、Agent应用 | 原生请求视图/执行集合约束、预算路由、精确来源外置与回读、持久宿主、真实DeepSeek验证、独立SDK分发 | 没有可信总体成功率或token收益；单租户验证应用 |
| 算法版第二项 | 研究资料检索与版本引用服务（Lab模块） | 检索、RAG、算法工程 | BM25/E5/RRF、完整SciFact固定评测、独立NIST核对、增量向量与版本引用 | 相关性分数不是QA准确率；不是复现论文图检索算法 |
| 应用版第二项 | 依赖升级审查工作台（Lab模块） | Agent应用、工具链、工作流 | 固定源码/锁/漏洞库、八项事实条件、JUnit证据绑定、LangGraph/SQLite恢复、真实维护输入 | 工作台为确定性证据流程，不宣称模型自主升级或漏洞清零 |
| 可选研究经历 | 工具调用监督目标与LoRA误差分析（Lab模块） | 明确要求训练实现的岗位 | 同初始化配对训练、目标掩码、生成与逐token损失分析、未知尝试记账 | 两组各32步的小预算研究，未完成多种子验证，不写成成熟训练产品 |

算法岗位建议“论文 + PiContextLab + 检索模块”；对训练实现追问深入时，再展示LoRA研究记录。Agent应用岗位建议“PiContextLab + 依赖审查工作台”。两个主要条目来自两个代码库；不把Pi的经营客户端、部署锁文件审计或SDK示例再拆成项目。

## 可直接使用的项目描述

### PiContextLab - Pi Agent Core上下文与工具策略改造

技术栈：TypeScript、Pi Agent Core、DeepSeek API、BM25、SQLite、DuckDB。

- 派生Pi 1.6.0核心，在规范化模型请求边界同时返回上下文视图与执行集合；实现工具依赖闭包、数量/schema双预算、有界目录索引及按需发现。
- 实现按完整用户轮次打包、SHA来源外置、批量JSON pointer精确续读、共享回读预算及响应后的空间规划；保留数值原始字面和权威历史，支持可选完整子树保留。
- 以完整541,909行公开交易数据构建经营指标验证应用，核对12个指标值与29个国家分组；101项工程控制和14项浏览器检查通过，持久额度/归属、来源核对和人工复核分别处理。

最新真实12请求来源审计四项均正确；一项回读由3条路径变1条，但请求数不变、开启输入更多，不能写效率提升。更多真实业务成功和失败见[完整讲解](handbook.md)、[项目说明](project-brief.md)、[原始验证](validation.md)。

### 研究资料检索与版本引用服务（Lab模块）

技术栈：LlamaIndex、LangGraph、MCP、multilingual-e5-small、SQLite。

- 实现BM25、E5语义和RRF融合排序、批量查询与资料版本快照，语义/融合共享查询向量。
- 对完整SciFact 5,183篇摘要、300题固定评测，nDCG@10分别为0.6409/0.6479/0.7040；以独立NIST程序核对逐题和总体指标。
- 管理三篇论文52页、240片段，新增92片段时复用原148向量，引用绑定PDF页/哈希/历史版本；提供持久检索任务和离线核查交付。

这些是摘要相关性、增量索引和恢复证据。真实本地4B阅读流程三题两项有效提交，资料缺失题未完成；2/3不是QA准确率。旧模型记录仅作已有证据，本轮不部署或运行本地模型。详见[固定版本原文](https://github.com/1137423918/AgentReliabilityLab/blob/583eb16e0a22e14ce6d815f5632a5559db2dfd85/portfolio/resume-shortlist-2026-11-25.md)。

### 依赖升级审查工作台（Lab模块）

技术栈：LangGraph、MCP、LlamaIndex FunctionAgent、SQLite、OSV-Scanner、uv。

- 固定真实仓库源码、依赖锁与漏洞库，串联扫描、候选解析、复扫及兼容证据读取，按八项事实条件生成带引用/哈希的报告。
- 实现批量处理和SQLite断点恢复，绑定JUnit测试ID、源码清单与锁文件身份，防止用错版本的测试结果。
- 覆盖Browser Use、FastMCP、LightRAG三个快照；工作台12项测试与独立SIGKILL恢复通过，LightRAG锁文件升级已提交正式PR。

不写模型自主完成全部维护，不将公告匹配消除当作漏洞清零，不将不同仓库测试数累加成统一成功率。详见[固定版本的工作台证据](https://github.com/1137423918/AgentReliabilityLab/blob/583eb16e0a22e14ce6d815f5632a5559db2dfd85/docs/dependency-workbench.md)。

## 论文和开源贡献

论文保留为科研经历：LS-DETR，IEEE Geoscience and Remote Sensing Letters，22卷，2025，DOI [10.1109/LGRS.2025.3575615](https://doi.org/10.1109/LGRS.2025.3575615)。本次重新核对了[IEEE出版元数据](https://ieeexplore.ieee.org/abstract/document/11020690)的题名、期刊、年份及DOI；第一作者署名沿用已有固定BibTeX，未增写新的模型分数、个人任职或会议级别。

开源栏优先选能独立复现触发条件的一条，例如[DeepTutor #2930](https://github.com/HKUDS/DeepTutor/pull/2930)的MCP分页发现修复。2026-11-25 19:54（UTC+8）认证API快照中，现有12条PR均正式、开放、未合并，未解决评审线程0，没有发现新评审事件。两条OpenHands PR仍有历史描述检查失败，不能写成所有CI全绿或已合并；其他暂无检查结论的PR也不作通过推断。

个人主页/Profile/Pages继续冻结。本文及新附件更新Pi项目仓库，不改旧Lab项目、旧PDF和既有定时任务。采用哪一版投递前，应先独立复现、理解并按实际承担情况调整措辞。
