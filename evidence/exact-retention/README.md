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

实际API必须在先行提交公开源码/方案后另执行，每项一次、全局最多24次、每项最多6次、每次最多1,536输出token、20秒、零内部重试；未知调用占额度。旧研究均保持关闭，发布预检时累计真实生成调用为105。CPU源码与API源码的身份及实际结果另列，不能把此节脚本结果当真实模型结果。

## 真实DeepSeek结果：关闭于12次请求

先行[3a111d8源码/方案](https://github.com/1137423918/PiContextLab/tree/3a111d8590406701e973131d7dbd15de9016985d)公开后，只执行一次[实际研究](study/summary.json)。173个输入文件与该提交字节一致，发送前无修改，结束后再次核对，见[完整执行证明](study/executed-source-proof.json)。四项均得到正确完整对象，[独立Python检查](study/independent-source-check.json)与原评分一致；这只是两个小样本来源审计，不是部署完成或普遍准确率。

| 任务 | 保留 | 正确完整对象 | 实际请求 | 回读 | 输入token（含缓存） | 输出token |
|---|---|---:|---:|---:|---:|---:|
| Linux DuckDB | 开 | 3/3 | 3 | 1 | 4,967 | 1,061 |
| Linux DuckDB | 关 | 3/3 | 3 | 1 | 4,491 | 1,098 |
| Pi来源区分 | 关 | 3/3 | 3 | 1 | 4,116 | 736 |
| Pi来源区分 | 开 | 3/3 | 3 | 1 | 4,967 | 743 |

两配置每项均有2次pressure准备/2次spill出现；开启保留各6次子树出现（同一来源跨两次准备，不等于6个唯一值）。最大视图均未超过24KiB。12次实际请求/12次预留，usage无缺失；合计输入18,541、输出3,638，已知峰值费率估计约USD0.006767，不是账单。关闭研究后不使用剩余12次额度，累计真实生成调用117次。

[轨迹审计](study/trace-audit.json)显示DuckDB开启保留时确实只回读缺少的bindings记录（1条路径），关闭时回读3条路径；两个已保留来源被用于缩小回读。然而两者都是一次批量调用，整个任务仍3请求，输入还增加。Pi任务两者仍回读3条路径。所保留单元还包含非请求的TypeScript平台项或项目根记录，说明词法密度不保证精确需求覆盖。不能声称无用，也不能写省token、少请求、任务成功率提升或原压力失败已解决。

这是描述性小样本、固定交叉顺序且有缓存影响，不证明单因果总体效果。原[provider边界及完整助手消息](study/results.json.gz)、[逐请求上下文](study/wire-transcripts.json.gz)、[资源/日志](runs/dependency-study-v1/)全部保留。模型说明、因果、安装可用性、安全和人工审核均不在评分范围内。

## 独立复现入口

严格复现本研究条件需检出先行提交`3a111d8590406701e973131d7dbd15de9016985d`，按根README在服务器安装冻结依赖并构建，使用全新输出目录：

```bash
node dist/scripts/run-dependency-audit-study.js /path/to/new-cpu-output --control
python scripts/audit_dependency_results.py /path/to/new-cpu-output/results.json.gz /path/to/new-cpu-output/independent-check.json
```

真实provider需后端配置`DEEPSEEK_API_KEY`、`METRICLAB_MODEL_URL=https://api.deepseek.com`、`METRICLAB_MODEL_ID=deepseek-flash`及`METRICLAB_DEPENDENCY_SOURCE_COMMIT`，省略`--control`。本自动任务的原研究和额度已关闭，不执行这些旧输入的重复付费复现或挑选分数；未来效果验证需另立独立任务与先行方案。CPU重现也只用于核查机制，不能把重复测量挑出的数字替换此处固定结果。
