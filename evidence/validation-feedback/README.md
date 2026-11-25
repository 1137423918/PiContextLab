# contextlab.8 有界schema校验反馈

这是新的CPU机制比较，不是已关闭压力任务的模型重试。原模型结果保持失败；本轮模型调用和GPU均为零。

- [固定方案](../../examples/validation-feedback-cpu-protocol.json)、[四项结果](results.json)、[冻结core7源码身份](baseline-source.json)。旧新输入/schema相同，均拒绝且不执行；原toolCall保持完整。
- [62项测试](tests.tap)、[完整UCI核对](uci-validation.json)、[14项浏览器检查](browser-result.json)、[逐文件源码清单](snapshot-manifest.json)、[冻结源码包](source-snapshot.tar.gz)、[服务器lock](package-lock.json)、[资源及各版测试](runs/)。严格复现用这里的lock覆盖源码包旧lock。
- [早期v2比较](earlier-results-v2.json)保留；v3只修正解析错误原文位于argumentsError的来源提示并增加断言，未改输入案例、schema或2KiB上限。最终v4补充辅助函数独立使用时的isError标记并断言；内容字节结果不变。

SDK显式选toolValidationFeedback:'bounded'才启用。PiMetricLab正常与恢复路径都开启，运行指纹升级；不自动迁移旧任务。只作用于validateToolArguments拒绝，保留上游coercion/clone和完整校验；不截短原参数、不放宽schema。完整输入在assistant arguments或解析失败的argumentsError。

content数组整个JSON最多2,048 UTF-8字节，包括JSON包装和转义；不是token上限或整个对话上限。反馈含字段诊断和最多8个顶层字段形状，不复述整段值；details只有字节计数。原assistant输入仍占上下文，且多个错误相加仍可能超限。未知工具、prepareArguments/hook/execute错误不属于这项格式化，不作通用脱敏保证。

CPU脚本纠正流程只证明回合接线，不能外推到真实模型会纠正、原多指标任务成功或省token。复现需独立构建旧48f237d的core7，再在本次core8源码包目录运行：

```bash
node dist/scripts/probe-validation-feedback.js /path/to/frozen-core7/vendor/pi-agent-core/dist/index.js /path/to/new-results.json
```

输出必须新文件；命令不读取API密钥、不调用模型。原研究、检索质量及路由计时不重跑。
