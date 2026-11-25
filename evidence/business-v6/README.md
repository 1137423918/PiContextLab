# core6 两项新业务集成

方案和模型执行源码先在[68cf51f](https://github.com/1137423918/PiContextLab/commit/68cf51fbbbd9b8d7c5d3dff9c848d0651344ca51)公开，再按固定协议执行一次。此研究已关闭，不追加质量重试。

- [运行前说明](../../docs/evaluation-business-v6-plan.md)、[固定机器协议](../../examples/business-v6-protocol.json)、[52项预检](preflight-tests.tap)。
- [全部任务、消息、预留、证据与原评分](results.json)、[逐例汇总](summary.json)、[Pi适配器边界输入](wire-transcripts.json)。边界输入不是HTTP body；只记录context/model/额度参数，不包含认证头或密钥。
- [独立CSV Decimal oracle](oracle.json)、[预检Top/OTHER/总额控制](oracle-validation.json)、[研究后全部原始分组行核对](raw-group-audit.json)。52项Node测试外，另有源码包边界控制及事后算术反例。
- [执行源码hash](source-sha256.json)、[119个文件与先行提交逐个匹配](commit-verification.json)、[研究源码包](study-source.tar.gz)、[当次服务器lock](study-package-lock.json)、[全部资源与协议](runs/)。
- 两份预算配置下生成的、未人工审核的[退货报告](reports/returns-april-may-country.html)与[商品报告](reports/net-sales-feb-halves-products.html)。HTML可下载后离线打开，不能把叙述当已核实事实。

共12次实际请求，两个任务×两配置均通过冻结评分。两个预算任务都没有触发外置/归档/回读，只能证明低压力集成；不是旧v4压力失败被修复或总体成功率提升的证据。两种配置预算不同；缓存和输出长度影响usage/估计费用。报告解释、因果与人工审核不在模型评分内。

核对范围更正：原预检说明把范围写宽。冻结评分验证Top、OTHER和总额；groups_checked是参与评分的oracle组数，不等于原始SQL行逐组相等。研究结束后另运行audit_business_rows_v6.py，逐条核对每个报告保存的全部分组/期间行（31国家组或2,417商品组），并拒绝错金额、缺组和重复行。原评分器与分数未改，也没有再请求模型。

新包仅含源码、文档、协议和必要oracle夹具，不嵌套旧证据archive。复现应使用对应study源码包和study lock；若重跑真实API会产生新费用和不同输出，不能覆盖既有结果，不能把同题重跑当独立证据。运行示例：

```bash
python scripts/oracle_business_v6.py /path/to/frozen/transactions.csv examples/business-v6-protocol.json /path/to/new-oracle.json
node dist/scripts/run-business-v6.js /path/to/datasets /path/to/new-oracle.json /path/to/new-output
```

执行前按官方DeepSeek后端配置环境密钥、模型URL，并设置METRICLAB_BUSINESS_SOURCE_COMMIT为实际构建的40字符提交。密钥只留后端内存/环境，不提交、不写入归档。上述命令是复现说明，本次固定研究不会再次运行。
