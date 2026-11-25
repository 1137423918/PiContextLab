# 结构化业务事实：先行方案与预检

此提交发布时，真实模型请求仍为0；实际API研究必须使用先行公开源码另行运行。两个新问题族：订单量/客单价联合变化、退货/净额勾稽。三项来源事实、两项优先组及勾稽值独立评分，解释与因果不评分。不是通用准确率基准。

- [机器协议](../../examples/brief-study-protocol.json)、[原core10协议](original-core10-protocol.json)、[任务/预算/评分等价核对](task-equivalence.json)。每任务最多8请求/1,536输出tokens，全局32请求；完整64KiB与预算20KiB顺序交错，无质量重试。
- [独立Python CSV/Decimal/set oracle](oracle.json.gz)来自完整541,909行；不送给模型。三个指标、Top20/OTHER/总额、全部保存组行及模型填写的数值/来源/方向/优先组/勾稽都检查。两个案例分组检查数分别2,974和3,108，不是独立统计样本数。
- [core10原控制](controls/core10/summary.json)：两个完整控制通过，两个预算控制读前拒绝。[core11控制](controls/core11/summary.json)：四个都通过，预算分支各2次pressure、2次回读、1个持久方案，最大20,438和20,390/20,480字节。只从当前provider视图读事实，笔记明确写在assistant记录内，不从Store/oracle补答案。
- [85项测试](preflight-tests.tap)、[全量UCI核对](preflight-uci.json)、[14项浏览器检查](preflight-browser.json)、[93执行文件核对](preflight-source-verification.json)、[源码包](preflight-source-snapshot.tar.gz)、[输入清单](preflight-snapshot-manifest.json)、[服务器lock](package-lock.json)、[全部资源/早期失败](runs/)。复现使用旁边的server lock，源包里的归档时lock为上一版本。

core11修复通用规划回退未留最低内容空间的问题，以有界搜索保留实际可行目标；紧预算读取可省重复元数据，原文、身份和精确游标不改。原任务、20KiB上限、模型额度和评分没有调整，未通过的旧控制保留。原关闭研究和89次生成请求不重开。

v1/v2双CPU80%非执行准入不足；之后预检使用单逻辑CPU、最低优先级，准入最低70%非执行比例、RSS4GiB/900秒硬限制。v3修复类型推断声明，v4暴露实际失败，v5通过。准入不代表独占物理核；候选搜索中间可能有幂等artifact写入，最终trace不是全部写次数。

这只是无密钥可行性，不是模型成功。默认Web仍为原报告，结构化研究客户端继承实际Pi宿主、九个可执行业务操作与原报告3,000字符序列化限制。完整/预算配置的details和工具集合不同，JSON字节不是HTTP体/token；不作规划单一因素因果或费用收益结论。
