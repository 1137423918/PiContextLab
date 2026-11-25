# 含Pi项目的新版岗位附件验证

本轮更新此前尚无Pi项目的附件，保留旧Lab文档/产物不变。论文沿用已有固定BibTeX，重新查到IEEE出版元数据的题名/期刊/年份/DOI；没有增加未提供的个人经历或论文性能数字。

- [正文/陈述来源映射](../../examples/role-briefs/)、[当前项目总表](../../docs/resume-portfolio.md)。13组陈述绑定27份原始来源或PR快照；35个文档输入文件与服务器执行字节一致，见[源码核对](source-verification.json)。
- [HTML构建](html-build.json)、[浏览器打印](browser-print.json)、[pypdf结构检查](pdf-structural-qa.json)、[独立PyMuPDF检查](second-renderer.json)、[字体收据](font-receipt.json)。两份各一页A4，各30段必需正文和9个链接完整，实际用到的字形程序及Unicode映射在PDF中。
- [视觉检查](visual-review.json)核对Poppler和PyMuPDF四张最新150dpi页面，中文显示一致、无裁切重叠；这只是助手做的文档视觉QA，不是业务报告的人类审核记录。
- [实际阶段](runs/role-briefs-v1/)为29.095秒、1CPU准入/nice19、RSS上限4GiB、owned0；没有安装新依赖，没有生成/嵌入/GPU或外部写入。复用原字体和环境，派生字体仅保存在本次私有输出。
- [完整执行输入](source-snapshot.tar.gz)、[清单](snapshot-manifest.json)与阶段日志保留；旧实验分数、关闭额度、原项目源码与个人主页均未改。当前核心仍contextlab.12；本轮只改文档交付。

只读GitHub核对在2026-11-25 11:54UTC完成：现有12条PR均正式OPEN、未合并、未解决线程0，没有新的评审事件。当前账号API凭据有效，因本机无gh而使用已授权的API连接；没有提交评论、改PR描述、重新触发CI、创建issue或请求合并。OpenHands两条的历史描述检查仍失败，未把暂无检查/等待批准当作通过。最小状态快照在[source-inputs/pr-status.json](../../examples/role-briefs/source-inputs/pr-status.json)；完整认证响应保留在本地任务记录中，不发布多余评论内容。

角色PDF位于[output/pdf](../../output/pdf/)，编辑HTML位于[examples/role-briefs](../../examples/role-briefs/)。它们是项目经历附件，不是虚构完整简历。117次Pi真实生成请求总数不变，也不与旧Lab的生成/检索实验相加成准确率。
