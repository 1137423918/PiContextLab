# contextlab.10 响应后纯回读空间规划

新的合成原生循环工程控制，实际模型调用0/GPU0，已关闭。不是已关闭DeepSeek压力任务重试，也不重跑检索、旧四源码字节或路由计时诊断。

- [固定方案](../../examples/result-headroom-cpu-protocol.json)、[全部六行旧新输出/投影/来源](results.json)、[冻结core9身份](baseline-source.json)。三种合成当前轮备注长度，四个同配方artifact，实际nativeAgent/parallel执行。
- 压力场景静态8KiB回读后超限；规划版按实际assistant和空结果事务收紧至5,996内容字节，下轮23,660/24,576字节，脚本provider可以继续。充足场景保持同样额度/结果；不足场景新版工具开始数0。
- [80项Node测试](tests.tap)、[全量UCI](uci-validation.json)、[14项浏览器检查](browser-result.json)。[各次资源及失败](runs/)包括v1准入不足、v2错误的测试消息数组断言、v3最终成功；未改固定案例/配额/配方来挑数字。
- [执行源码包](source-snapshot.tar.gz)、[清单](snapshot-manifest.json)、[87文件当前代码核对](source-verification.json)、[服务器lock](package-lock.json)。严格复现用此lock替换源码包root lock，旧core9单独按daac8ab构建；发布文档/补丁随后更新，不改当次输入。

规划点在完整响应返回后、工具开始前。核心只允许降低已有组上限，默认不启用；本应用budgeted模式显式开启。方案先与持久保存的具体响应绑定并写入，再执行；恢复按原方案和原整批分配，不从剩余调用或部分结果获取新大池。缺少方案时仅用原响应前来源重建；旧运行配置不静默迁移。

256字节/调用包装余量只面向通常内建回读。混合批次仍静态；任意hook的usage/元数据、transform、外部消息、后续工具集仍可能改变大小，必须保留发送前硬检查。较小目标的投影打包可能写artifact后失败，最后trace不能声称全部中间写次数。原调用及原文完整，不能将短页解释成任务无损、token收益或真实模型成功。

```bash
node dist/scripts/probe-result-headroom.js /path/to/frozen-core9/vendor/pi-agent-core/dist/index.js /path/to/new-results.json
```

输出必须新文件，复现不是新的未见评测；不要调整备注或配额反复刷结果。详情见[框架公式](../../docs/framework.md)和[完整验证说明](../../docs/validation.md)。
