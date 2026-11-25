# 累计中等结果压力：core6控制、core7修复与真实失败

新方案在[1c386e7](https://github.com/1137423918/PiContextLab/commit/1c386e795ff43745c8880e63ae818e5266998764)公开后才发出真实请求。[运行前说明](../../docs/evaluation-pressure-business-plan.md)与[机器协议](../../examples/pressure-business-protocol.json)固定工作流、预算、请求上限和评分；本次研究已关闭，不追加质量重试。

- [core6脚本控制](controls/core6/summary.json)在预算分支拒绝；[core7相同控制](controls/core7/summary.json)完成并外置两条结果，视图24,564/24,576字节。都是显式脚本provider，不是模型准确率。
- [候选门槛根因](preflight-cause.json)、[任务/预算等价](task-equivalence.json)、[56项测试](preflight-tests.tap)、[独立CSV Decimal oracle](oracle.json)。评分检查九份来源、Top/OTHER/总额与全部保存SQL分组行；8,544组次包含跨指标/维度重复。
- [真实汇总](summary.json)、[完整记录gzip](results.json.gz)、[Pi边界输入gzip](wire-transcripts.json.gz)、[外置分析](analysis.json)、[离线失败诊断](failure-analysis.json)。gzip只压缩原JSON字节，不删失败；边界输入不是原始HTTP body，记录不包含认证头。
- [128文件逐个提交核对](commit-verification.json)、[实际源码hash](source-sha256.json)、[模型执行源码](study-source.tar.gz)、[当次lock](study-package-lock.json)、[资源和失败记录](runs/)。老core6控制源码也保留，解包使用其对应lock，不覆盖环境。

真实模型两种配置均未封存报告：完整分支6请求，三次interpretation超3,000字符且错误回显参数，随后触及发送上限；预算分支4请求，成功prepare记录中有4条低阈值外置，随后四个并行回读后当前轮超限。两分支都取得9份查询证据，但原定任务评分仍失败。保存了10个实际调用与预留，无缺失usage；不是用脚本替代模型结果。

外置计数来自成功prepare的trace；失败prepare可能有中间artifact写入，不能据此推导精确存储写次数。费用是冻结单价估计，不是账单；失败任务较少token不能解释成效果或成本收益。错误反馈回显与并行回读是观察到的因素，没有独立消融把它们认定为唯一原因。

复现控制使用冻结源码包、对应lock和新的输出目录：

```bash
python scripts/oracle_pressure_business.py /path/to/frozen/transactions.csv examples/pressure-business-protocol.json /path/to/new-oracle.json
node dist/scripts/run-pressure-business.js /path/to/datasets /path/to/new-oracle.json /path/to/new-output --control
```

该命令不读密钥、不调用模型。真实API复现应去掉--control并显式配置官方DeepSeek后端及METRICLAB_PRESSURE_SOURCE_COMMIT，会产生新费用和不同结果；本次关闭研究不再执行。原始gzip可用Python gzip或Node zlib解压读取。SDK源码改动只证明指定程序问题已修复，没有实际任务成功率提升结论。
