# contextlab.5 CPU 工程控制

这是新的合成机制诊断，不能解释为模型准确率、真实 token 或费用提升。旧 ToolRet、8 条字段定位诊断和 DeepSeek v1/v2/v4 研究均不重跑。

- [冻结方案](../../examples/pressure-policy-cpu-protocol.json)、[逐例结果](results.json)、[旧版源码身份](baseline-source.json)。相同消息分别传入冻结 core4 与 core5，没有修改权威 transcript。
- [44 项测试](tests.tap)、[全量数据核对](uci-validation.json)、[14 项真实浏览器检查](browser-result.json)。浏览器与全量数据使用显式脚本 provider，不是大模型效果评测。
- [执行源码 SHA256](source-sha256.json)、[完整输入源码包](source-snapshot.tar.gz)、[服务器生成的锁文件](package-lock.json)、[资源及阶段协议](runs/)。复现时用这里的 lock 覆盖源码包中的旧 lock，然后在新目录安装。
- 前两次类型检查失败发生在执行诊断前，日志与资源报告均保留在 runs；分别修复了可空游标类型、循环内类型推断与未使用变量。没有改动预期结果或重复已评分诊断。

三组输入均为特制程序控制：视图已满足预算、仅需外置一个大结果、最新两个并行回读应共同保留。它们证明相应实现行为，不能外推到所有对话或已失败的真实模型任务。JSON 字节度量不是供应商 HTTP 请求体大小。

复现只需 CPU，先按固定提交 fc2d13c 在独立目录构建旧 core4，再构建新版：

```bash
node dist/scripts/probe-pressure.js /path/to/frozen-core4/vendor/pi-agent-core/dist/index.js /path/to/new-results.json
```

输出必须是新文件。该脚本验证预期机制和输入未改，不加载密钥或调用模型。既有结果不可覆盖；重新执行相同诊断不构成独立验证。
