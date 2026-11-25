# 查询相关的精确JSON子树保留

这是默认关闭的Pi核心选项，完整来源外置后，在剩余空间内保留完整JSON值、路径和精确数值字面；不生成摘要、不用业务答案/评分标签。核心为contextlab.12。来源完整性与模型是否完成任务分开验证。

## 工程与预检

- [101项服务端测试](tests.tap)、[完整541,909行UCI核对](uci-validation.json)、[14项浏览器检查](browser-result.json)均通过。正常原生Agent provider边界、数值原字面、完整子树/路径、权威历史不变、字节增量上限、取消/错误/最新回读保护均有控制。
- [执行源码核对](source-verification.json)、[冻结源码](preflight-source-snapshot.tar.gz)、[清单](preflight-snapshot-manifest.json)、[服务器lock](package-lock.json)记录实际输入。
- 最终CPU任务retention-v8为67.476秒、owned0/GPU0。此前构建类型错误、两次CPU无空闲准入、脚本参数错误及源码均见[runs](runs/)；不删除失败。

## 关闭的集中度预检

[原方案](../../examples/concentration-study-protocol.json)和[四项原结果](concentration-no-pressure/summary.json)：国家/商品Top3绝对贡献和及反向贡献核对均正确，最高18,331字节，全部没有压力、外置或回读。按先定门槛关闭，未支付、未降低24KiB预算重跑。每个报告另核对2,848或2,972完整分组；[24项污染/缺失声明控制](concentration-grader-controls.json)均拒绝。它不是模型结果或保留策略的效果证明。

## 新部署锁文件审计

[新协议](../../examples/dependency-audit-protocol.json)使用6bf2b5b中的完整公开package-lock（62,649字节/123条packages），源SHA为`6df9522be82fde66701f3247ad2146d3762fae046909f8391635ae9ed9f6b278`。两项新任务分别核对DuckDB平台依赖、npm原版别名与本地派生核心的完整记录。两配置的24KiB上下文、工具、模型、schema和调用上限相同，仅切换保留选项。此处核对的是固定历史来源，不是当前机器安装状态、安全评估、许可审查或人工审批。

第一版脚本错误地请求8,192字符，真实回读schema上限为4,096；四项均在校验拒绝后耗尽脚本额度，见retention-v7。修正脚本参数至4,096，源文/问题/字节/调用/token预算/选择常量未变，实际模型从未受这段脚本控制。

[修正后四项CPU原生Agent结果](dependency-preflight/summary.json)均正确，每项3次脚本provider请求/1次回读/2次pressure准备；开启保留后各记录6次子树保留出现，但没有减少脚本回读或调用数。最大视图分别为9,896、8,546、7,826、9,227字节。16项缺失/重复/空对象控制拒绝；[独立Python检查](dependency-preflight/independent-source-check.json)与全部原评分一致。这些只是工程预检，不是大模型收益。

实际API必须在先行提交公开源码/方案后另执行，每项一次、全局最多24次、每项最多6次、每次最多1,536输出token、20秒、零内部重试；未知调用占额度。旧研究均保持关闭，当前累计真实生成调用仍为105。CPU源码与API源码的身份及实际结果另列，不能把此节脚本结果当真实模型结果。
