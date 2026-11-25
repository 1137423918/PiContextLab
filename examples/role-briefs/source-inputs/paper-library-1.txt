# 离线核对回答与引用原文

已有阅读报告记录问题、模型回答及页引用。需要逐条检查解释时，可以生成独立核查页，把原回答和当时实际读取的原文片段放在一起，再下载核查备注，下一次打开同一页面时导入继续。

它是现有研究助手的交付流程，复用LangGraph/SQLite终态报告和LlamaIndex版本引用读库；不恢复图、不检索、不调用模型或重新判定旧答案。

## 生成与使用

从仓库根目录，使用[已有研究助手环境](../extras/research-assistant/README.md)：

```sh
extras/research-assistant/.venv/bin/python -m agent_lab.research_review prepare \
  --run-dir /path/to/stopped-reading-run \
  --run-dir /path/to/another-stopped-run \
  --store /path/to/paper-store \
  --output /path/to/new-private-review
```

输入须是本工具创建、写入已停止且SQLite连接关闭的本地运行与可信资料库；同原有阅读报告契约，一次1–16项。输出放在运行和资料库之外的新目录，不覆盖已有交付。

双击 `source-review.html` 即可离线查看。左侧保留原回答与未完成原因，右侧展示精确引用片段、物理页/页标签、字符范围及片段哈希；历史资料版本仍从归档回读。页面无外部脚本、字体、模型服务或自动网络访问，点击论文标题才打开在线来源。

- 选择“待核对”“标记已核对”或“需修改”，填写备注和选填的核查人显示名。
- 点击“下载全部核查备注”，保存 `review-notes.json`；筛选只影响显示，下载覆盖全部记录。
- 下次打开同一核查页，导入该JSON继续。关闭页面前未下载的标注会丢失；页面不保存浏览器存储、不上传内容。
- 搜索涵盖问题、回答、原文和备注；打印保留当前筛选，并展开完整备注文本。

另有 `source-review.json`、初始 `review-notes.json` 和绑定三份文件哈希的 `review-manifest.json`。**核查页和bundle包含论文原文片段、问题与回答，分享前应审阅全部内容；隐藏/筛选不会删去其他记录。** 普通阅读报告仍不含原文片段，原有输出格式保持不变。

## 标注如何与原记录对应

每份备注绑定整个bundle指纹；每项再绑定顺序、原运行、回答和引用原文的指纹。导入前完整检查记录数量、已知ID、重复ID、回答身份、状态和长度，全部通过后才更新页面。不同回答/资料版本、混入其他记录、未知字段或超限内容不会部分覆盖当前标注。备注限制1000个Unicode码点，核查人显示名120个，导入文件最大1MiB。

未完成/导出异常的任务仍没有可核对的已接受回答，不能标为“已核对”，但可记下后续处理备注；来源无法回读的记录同样保留不可核对状态。已接受的“资料不足”回答没有引用片段时，页面也不据此证明资料覆盖充分。

“已核对”是操作者声明，**不是自动蕴含判断、真人身份认证或签名**。导入文件可以由其持有人编辑；哈希用于防止不同内容串用，不是第三方真实性证明。应用不修改原 `result.json`、SQLite、模型回答或原始提交状态，不将标注计作模型准确率。

可以用后端校验下载的备注：

```sh
extras/research-assistant/.venv/bin/python -m agent_lab.research_review check-notes \
  --bundle /path/to/new-private-review/source-review.json \
  --notes /path/to/downloaded-review-notes.json
```

输出各状态的标记数量，`reviewer_identity_verified=false`。缺失/错配来源的生成命令仍交付分项记录但返回2；原任务未完成本身不使导出失败。源目录、原始模型通信和完整PDF不会被复制进核查页。

## 演示与验证

演示使用自有合成原文、脚本化模型回复和实际LangGraph/SQLite流程，不是新模型评测，也不是对历史论文回答的真人复核。真实四项已关闭运行的引用回读与浏览器验证另列在完成后的证据目录，原有质量结论保留。

本次工具复用冻结的研究助手环境与 `agentlab-research==0.2.0` 引用读库，没有重装依赖；0.3.0的独立批量检索wheel/启动包不包含这个仓库级核查CLI。按上面的仓库模块入口使用，无需启动模型、MCP或嵌入服务。

本轮已完成新增10项后端控制、14项Chromium交互检查，以及4个已停止真实运行的6条历史/当前引用回读；新增生成、嵌入和GPU均0。[自有离线演示](../examples/research-review/README.md)、[完整证据与保留失败](../evidence/research-review/README.md)。实际论文片段只在私有输出中保留，未上传公开仓库。
