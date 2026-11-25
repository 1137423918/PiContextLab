# 结构化业务事实：先行方案与预检

先行提交[302cf1d](https://github.com/1137423918/PiContextLab/commit/302cf1d888288ee1d2893c010517f3eea7677d43)发布时，真实请求为0。随后已按该固定源码执行一次实际API研究，16请求后关闭。两个新问题族：订单量/客单价联合变化、退货/净额勾稽。三项来源事实、两项优先组及勾稽值独立评分，解释与因果不评分。不是通用准确率基准。

- [机器协议](../../examples/brief-study-protocol.json)、[原core10协议](original-core10-protocol.json)、[任务/预算/评分等价核对](task-equivalence.json)。每任务最多8请求/1,536输出tokens，全局32请求；完整64KiB与预算20KiB顺序交错，无质量重试。
- [独立Python CSV/Decimal/set oracle](oracle.json.gz)来自完整541,909行；不送给模型。三个指标、Top20/OTHER/总额、全部保存组行及模型填写的数值/来源/方向/优先组/勾稽都检查。两个案例分组检查数分别2,974和3,108，不是独立统计样本数。
- [core10原控制](controls/core10/summary.json)：两个完整控制通过，两个预算控制读前拒绝。[core11控制](controls/core11/summary.json)：四个都通过，预算分支各2次pressure、2次回读、1个持久方案，最大20,438和20,390/20,480字节。只从当前provider视图读事实，笔记明确写在assistant记录内，不从Store/oracle补答案。
- [85项测试](preflight-tests.tap)、[全量UCI核对](preflight-uci.json)、[14项浏览器检查](preflight-browser.json)、[93执行文件核对](preflight-source-verification.json)、[源码包](preflight-source-snapshot.tar.gz)、[输入清单](preflight-snapshot-manifest.json)、[服务器lock](package-lock.json)、[全部资源/早期失败](runs/)。复现使用旁边的server lock，源包里的归档时lock为上一版本。

core11修复通用规划回退未留最低内容空间的问题，以有界搜索保留实际可行目标；紧预算读取可省重复元数据，原文、身份和精确游标不改。原任务、20KiB上限、模型额度和评分没有调整，未通过的旧控制保留。原关闭研究和89次生成请求不重开。

v1/v2双CPU80%非执行准入不足；之后预检使用单逻辑CPU、最低优先级，准入最低70%非执行比例、RSS4GiB/900秒硬限制。v3修复类型推断声明，v4暴露实际失败，v5通过。准入不代表独占物理核；候选搜索中间可能有幂等artifact写入，最终trace不是全部写次数。

这只是无密钥可行性，不是模型成功。默认Web仍为原报告，结构化研究客户端继承实际Pi宿主、九个可执行业务操作与原报告3,000字符序列化限制。完整/预算配置的details和工具集合不同，JSON字节不是HTTP体/token；不作规划单一因素因果或费用收益结论。

## 固定源码的真实 DeepSeek 结果

[四实例汇总](study/summary.json)、[完整结果](study/results.json.gz)、[Pi provider边界输入](study/wire-transcripts.json.gz)、[来源核对](study-source-verification.json)、[调用/工具/配额分析](analysis.json)、[失败定位](failure-analysis.json)。151个输入文件与先行提交逐一核对，API前再次检查无源码改写；共16实际请求/16预留、无缺失或零usage记录，无追加、无重试。

- 完整配置：两个实例均封存且通过全部来源事实、优先组、勾稽和原始分组检查。[订单/客单价报告](study/summer-order-value-full.html)、[退货/净额报告](study/autumn-return-offset-full.html)。它们仍无人工审核，解释与假设没有评分。
- 订单/客单价预算配置：触发pressure并记录5次外置出现；随后请求4次/result回读，规划器未找到可行最低投影，任何读取尚未开始就终止，没有报告。
- 退货/净额预算配置：触发pressure并记录6次外置出现，不回读就提交；三项比较事实和净额勾稽正确，但将整体毛销售变化96,389.1280写成英国贡献（实际41,898.5380），并填写该期间oracle中不存在的商品组23843。报告虽封存仍按原规则失败，错误报告也保留。

两个预算实例均无实际回读结果/持久预算方案，不能声称真实模型验证了紧凑读取或规划收益。原v4/v7研究仍失败；这次也没有证明预算策略提升准确率、token或费用。总已知usage峰时单价估计约$0.0155，非账单。资源最终owned0/GPU0，模型研究已关闭，不用剩余额度重试改分。
