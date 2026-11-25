# LightRAG：从真实维护需求到可审阅 PR

为依赖升级审查应用接入第三个真实项目，并把候选交付给上游维护者：[HKUDS/LightRAG #4647](https://github.com/HKUDS/LightRAG/pull/4647)。截至2026-11-24 UTC 14:39，PR为正式、开放、未合并；5个原生工作流均为 `action_required` 且 jobs 为零，等待上游批准运行。服务器测试通过不能替代上游 CI。

选择项目时核查了[HKUDS组织](https://github.com/HKUDS)的 Data Intelligence Lab@HKU 自述，属于学术团队；不推断团队人数。观察星数40,844只是当时快照。固定发布版v1.5.8（北京时间11月24日发布）、源码 `7169588d0a27f86d30e5de48c60301a899e61b93`，读取仓库维护规则后，使用其实际 `uv.lock`、声明和测试。另一个候选 nanobot 没有已提交的锁文件，未为凑案例制造锁文件。

## 实际维护流程

1. 在服务器下载并冻结11月24日的 OSV PyPI 库，再执行原始锁文件扫描。OSV Scanner2.7.1和数据库均记录哈希；与旧 Browser Use/FastMCP 的11月23日数据库分开。
2. 按预先声明的确定性条件选择 RAGAS0.4.3，执行 `uv lock --upgrade-package ragas`，保持 `pyproject.toml` 和所有版本声明不变。RAGAS属于可选 `evaluation` extra，不把它描述为所有默认安装必备依赖。
3. 候选为0.4.4，237个包块中仅 RAGAS 一块改变，其余236块相同。236个 registry resolutions 全部覆盖；本地 editable 根包不计入 registry 统计。
4. 对候选用同一冻结库复扫：目标匹配为零，新增 package/advisory 匹配为零，受影响 registry resolutions 从18降至17。统计覆盖锁定的可选、开发与条件依赖，不等于部署环境或可达性分析。
5. LangGraph/SQLite工作台绑定报告、源码清单与配对JUnit，生成 `scoped_tests_passed` 审查报告；再次执行复用已完成项，三份内容文件字节一致，汇总JSON中的复用计数按设计变化。最终发布审批仍为false。

[OSV目标公告](https://osv.dev/vulnerability/GHSA-95ww-475f-pr4f)的 GHSA、PYSEC-2026-3046、CVE-2026-6587 是同一公告的别名。其范围使用 `last_affected=0.4.3`，不能只凭范围外版本断言修复。另对实际发布的0.4.3/0.4.4 wheel做静态源码比对：相关多模态图像/提示加载路径改用 `_safe_fetch`，加入非公网地址、对端与重定向校验，以及本地图片显式启用限制。保留wheel和源码哈希；未做真实漏洞利用或全面安全验证。

## 对应源码的兼容性验证

| 被测源码 | 原始／候选 | 范围 |
| --- | --- | --- |
| 发布版 `7169588…` | 同一组21项，两边全通过，零跳过 | 工作台兼容记录绑定此发布版 |
| PR基线主线 `cf82ba9…` | 同一组21项，两边全通过，零跳过 | 主线与发布版有11个Python文件不同，另建环境实际验证 |

两组都安装真实 `api`、`pytest`、`evaluation` extras，执行上游 `tests/evaluation -m offline`，在测试收集后核验 RAGAS 版本/导入位置和 `RAGAS_AVAILABLE=True`。服务器Python3.11；原生CI使用Python3.12，不能声称已覆盖全部平台。测试期间禁止INET连接，实际被阻止尝试为零；部分上游测试模拟judge分数，不是LLM评分或RAG答案质量验证。21项为每对源码的同一批ID，不是84项独立案例。

主线候选另完成 `pre-commit run --all-files`，Ruff、格式与文件规范全部通过；被测源码清单确认只有 `uv.lock` 改变。最终PR基于精确测试的主线提交，head为 `3c4e90508d7e9f3404b76bb54b96350354bc1341`，仅提交锁文件，不改上游测试或源代码。

## 使用现成工作台读取新案例

在已安装本仓库工作台依赖的服务器上：

```sh
python -m agent_lab.review_workbench \
  --root evidence/lightrag-dependency-upgrade/corpus \
  --manifest evidence/lightrag-dependency-upgrade/corpus/catalog.json \
  --compatibility-manifest evidence/lightrag-dependency-upgrade/compatibility/compatibility.json \
  --run-dir /tmp/agentlab-lightrag-review-new
```

目录构造器新增 `--expected-count`（1–32），本例显式传1；旧默认值2保留，并实际验证默认拒绝不完整单项目输入。当前改动字节与服务器被测源码一致。工作台核心未改，无需重复既有12项应用控制与历史279项FastMCP兼容测试。

原始安装第一次因下载耗时超过600秒终止，没有运行测试；从相同缓存继续后通过。主线首次HTTP/2拉取失败发生在安装和测试前，后用HTTPS/HTTP1.1拉取精确提交后通过。扫描前的Git调用路径错误也保留。没有将这些失败改写为成功；整个案例只扫描两次，新增模型调用与GPU使用均为零。

[完整公开证据与来源](../evidence/lightrag-dependency-upgrade/README.md)包含投影扫描、真实配对JUnit、源码哈希、工作台输出、失败回执与PR状态。完整扫描和数据库在服务器只读归档。本例支持“完成真实维护候选与可复查交付”，不支持“模型自主修复”“所有漏洞清零”“已合并/上线”的表述。
