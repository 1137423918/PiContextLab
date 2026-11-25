# contextlab.6 CPU 路由开销对照

此目录是新的系统性能诊断，不是再次评价旧ToolRet标签、模型准确率或端到端Agent速度。所有旧研究分数保留。

- [冻结方案](../../examples/routing-cache-cpu-protocol.json)、[全部32次调用/16组配对](results.json)、[旧源码与原始目录提取身份](baseline-source.json)。结果只发布哈希、计时和ID；不重新分发原工具文档。
- [51项测试](tests.tap)、[14项真实浏览器检查](browser-result.json)、[全量数据核对](uci-validation.json)。业务流程provider是显式脚本控制，本轮没有大模型调用或GPU。
- [执行源码身份](source-sha256.json)、[冻结输入源码](source-snapshot.tar.gz)、[当次服务器锁](package-lock.json)、[资源及失败记录](runs/)。源码包中的旧lock需由本目录lock覆盖。

冷启动包括在缓存变体的16个样本中。索引构建1次/命中15次；全部排名分数、顺序、选集和schema成本逐对核对一致。默认源文本预算32MiB；实际保留26,306,261字节，不是堆内存上限。

数据目录存在1,211条非对象参数描述，初始驱动在计时前拒绝；修正为在惰性schema的x-catalog-parameters中保留原值，检索文档仍保留原始参数。没有删除任何行、改query、改缓存额度或按计时挑结果；所有37,292行均进入同一负载。另保留计时前的首次严格类型错误。

严格复现使用这里的core6源码包和锁，先按3cda10c独立构建旧core5。经原有固定哈希流程准备目录，仅导出tools后运行：

```bash
python scripts/prepare_routing_workload.py /path/to/normalized.json /path/to/new-tools-only.json
node dist/scripts/probe-routing-cache.js /path/to/new-tools-only.json /path/to/frozen-core5/vendor/pi-agent-core/dist/index.js /path/to/new-results.json
```

输出必须全新；不执行目录API，也不读模型密钥。复现耗时会受机器负载、GC和目录序列化影响，不能保证数值相同。重新运行相同负载不构成新的独立性能证据。
