# contextlab.9 同一批次共享回读预算

新CPU机制诊断，未调用真实模型、未使用GPU，已关闭。旧压力任务及其他关闭研究不重跑。

- [方案](../../examples/recall-budget-cpu-protocol.json)、[两版本结果及四个输入SHA](results.json)、[冻结core8身份](baseline-source.json)。同一批四次原生并行读取，旧31,262、新8,187 content JSON UTF-8字节；新版配置总8,192、每次2,048。
- [71项测试](tests.tap)、[完整UCI核对](uci-validation.json)、[14项浏览器检查](browser-result.json)、[资源与初期错误](runs/)。v1编译声明位置错误、v2测试类型错误均保留，v3通过70项，v4加低层stream终止控制与首次本对照，通过71项。
- [源码包](source-snapshot.tar.gz)、[输入清单](snapshot-manifest.json)、[84个当前执行源码/配置核对](source-verification.json)、[服务器最终lock](package-lock.json)。复现时用此lock覆盖源码包root lock，再安装/构建；源码包排除历史证据归档，较早失败/通过版本各自源码包在runs。

SDK显式配置toolResultBudgets才启用；读取/搜索共享context-recall组，256字节最低、8,192最高。分配不依赖完成顺序，未用配额不回收。最低额不可行时执行前失败，Agent与两种低层stream都结束；原assistant未完成调用仍留存审计，不自动重试。默认full模式不配置组预算，budgeted宿主配置8KiB；恢复按原整批分配后跳过已完成项。

完整content数组的JSON包装和转义计入预算，读取按实际code points给续读参数，原文不改。元数据放不下明确deferred，不表示EOF/无匹配；0字但has_more也需调整批次/路径或宿主预算，不能无界原样重试。最终hook输出超限会替换为小错误，但已发生副作用不能回滚。

仅限制指定组最终content，不包括ToolResult外层、details、partial updates、assistant或其他工具内容，未预留完整下一轮空间。新版只是更短第一页，不能将31,262→8,187解释成相同信息量的压缩率、token收益或模型成功率。CPU脚本provider不是大模型，本轮真实请求0。

严格复现需另行检出并构建dcb715d的core8，然后在本次冻结源码、服务器lock构建后运行：

```bash
node dist/scripts/probe-recall-budget.js /path/to/frozen-core8/vendor/pi-agent-core/dist/index.js /path/to/new-results.json
```

输出必须新文件。发布文档/补丁随后更新，四文件输入以当次结果SHA和源码包为准；lock使用服务器冻结的9版。不要在新文档上反复运行来挑更好数字。真实模型效果需要独立新任务及冻结方案，原模型失败结果不变。
