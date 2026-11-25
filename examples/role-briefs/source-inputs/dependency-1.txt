# 真实依赖升级候选的证据审查

这个应用面向维护者准备依赖升级的实际流程：固定项目源码和锁文件，用同一份离线漏洞库扫描原始依赖；按预声明规则选一个目标，保持原始声明不变执行真实解析；再次扫描候选锁文件，检查目标变化、遗留匹配和新增匹配。Agent 通过真实 MCP 读取这些事实、选择字段并提交审查结论。它提供进入兼容性测试的候选判断，不代替安全分析、上游测试或发布审批。

[两份实际项目输入及扫描证据](../evidence/dependency-upgrade/README.md)来自 Browser Use1.0.8 和 FastMCP2.12.4 的固定发布提交。Browser Use 的 Pillow 精确版本声明使目标未升级，候选不通过；FastMCP 的 Authlib1.6.1→1.9.10 消除了目标匹配，且没有新增包/公告匹配，可以进入兼容性测试，但仍有16个 registry resolution 匹配公告。扫描包括开发、可选及条件依赖，不能直接解释为已部署或可利用的漏洞数量。

## 实现与真实模型结果

[准备器](../agent_lab/dependency_review.py)拒绝扫描结果中未声明的额外 registry 依赖，显式区分 editable/root 等来源，保留原始/候选锁文件、实际 Git diff 和工具退出状态。目标选择先于结果：优先直接声明依赖，再按扫描公告组数排序，同分按名称。相同离线数据库避免候选对比混入公告更新。

[报告构建器](../benchmarks/dependency_review_corpus.py)只向 MCP 提供事实，隐藏准备器的整体判定；已知任务答案在服务目录之外，八项事实条件与结构化 verdict 分别校验。模型选择字段引用，消费端仅装配它本次实际读取的值、哈希与回执，不补齐缺失事实。原核验器、绑定器和任务评分保持不变。

服务器9项单元控制、4场真实 MCP/TCP 脚本场景通过。后者12次脚本 POST 包含“来源合法但项目错误”和“事实合法但结论错误”两项负向控制，不计入神经模型准确率。另一次真实 Qwen3.5-9B 运行完成两题、通过一题，共6次模型 POST：Browser Use 结论正确却漏选“原声明未改变”事实，按原规则失败；FastMCP 八项事实及结论通过。[逐题结果与完整边界](../evidence/dependency-upgrade/model-v1/README.md)。这两题由了解输入的操作者编写，不能据此估计泛化准确率。

## 在服务器运行

Python3.11+、Git、固定 uv 和 OSV-Scanner2.7.1。准备两个含完整构建元数据的本地 Git 仓库，必须能检出输入清单中的准确提交。仅复制 pyproject/lock 会遗漏 README 等元数据；uv 可能在隔离缓存安装 build backend 并执行 metadata hooks，本工具未安装项目运行环境或运行上游测试。

```sh
python -m agent_lab.dependency_review \
  --inputs evidence/dependency-upgrade/inputs \
  --output /tmp/new-dependency-review \
  --scanner /path/to/osv-scanner --uv /path/to/uv --python /path/to/python3.11 \
  --database /path/to/cache/osv-scalibr/PyPI/all.zip \
  --database-sha256 "$FROZEN_DB_SHA256" \
  --source-repo browser_use_1_0_8=/path/to/browser-use \
  --source-repo fastmcp_2_12_4=/path/to/fastmcp
```

输出目录必须是新的。源码提交分别为 Browser Use `753d629d76eb2b670f4cf467f3355bbe750f6845`、FastMCP `b96e6ebbb269a241801554383671ba9f2876901e`。扫描器二进制必须符合输入清单摘要。历史实验数据库 SHA256 为 `364b26a5eb863e9d95957ada2ad0027a12a2a2ca80d91aa2e1db6dcd64dccaf9`，服务器留存；公共仓库未附38MB数据库，在线 latest 地址会变化。新数据库必须先固定摘要，作为新的数据快照，不能声称重现了历史字节。解析器仍可在线访问包元数据。

直接消费已发布报告时，使用 `evidence/dependency-upgrade/corpus/catalog.json`。其 source URL 绑定含相同报告字节的不可变提交。沿用 [MCP 参考提交入口](reference-submission.md)，把 root/manifest 换为此目录，cases 换为 `benchmarks/dependency_review_cases.json`，case 选 `browser_use_1_0_8_integration_gate` 或 `fastmcp_2_12_4_integration_gate`，catalog policy 为 `all`。资源准入与本地模型部署应另外配置，运行时使用新的私有状态目录。

早期 editable root 解析错误、稀疏源码和额外 no-build 限制均保留为失败准备记录；最后的标准 uv 流程修正这些实现/准备问题，没有放宽项目版本声明。14次实际离线扫描包含调试，不是14个独立项目。原始扫描留在服务器，公开投影省去公告正文，区分原始哈希与公开哈希。所有运行、测试在授权服务器完成，个人主页保持冻结。

后续已在两个独立项目环境完成同一批279项上游鉴权相关测试，原始与候选锁文件均全部通过。实际环境变化为Authlib1.6.1→1.9.10及新增joserfc1.8.0，源码与测试未改；这是特定范围的兼容性证据，完整CI与发布审批尚未执行。[配对测试、日志与边界](dependency-upgrade-compatibility.md)。
