# 含PiContextLab的岗位项目经历附件

两份2026-11-25版单页A4，将新PiContextLab加入现有科研/项目材料：

- [算法与模型研发PDF](../../output/pdf/algorithm-project-experience-pi-2026-11-25.pdf) / [可编辑HTML](algorithm-project-experience-pi-2026-11-25.html)：Pi框架改造与研究检索模块。
- [Agent应用开发PDF](../../output/pdf/agent-app-project-experience-pi-2026-11-25.pdf) / [可编辑HTML](agent-app-project-experience-pi-2026-11-25.html)：Pi领域宿主与依赖审查工作台。
- [当前项目总表与取舍](../../docs/resume-portfolio.md)。LoRA小预算研究保留为可选经历，不包装成成熟训练产品。

两版均保留第一作者论文、DeepTutor正式PR及未合并状态；不添加教育/实习/生产客户。Pi与Lab分别列示，Lab内条目明示为模块，不拆出虚假独立产品。默认应用仍走完整上下文，模型效果与检索分数的限制保留。

`content.json`为可编辑正文，`evidence.json`将13组陈述绑定27份固定来源/状态快照。`source-inputs/`是对应原始字节副本，扩展名`.txt`避免误把异处源码/Markdown当可执行文件或本目录相对链接；原仓库、提交、文件名、URL及哈希仍在映射中。Pi依据ddb8175，旧Lab依据583eb16，旧Lab源码/旧PDF和主页均未编辑。

[完整验证](../../evidence/role-briefs/)记录源码身份、两种PDF引擎、字体和视觉检查。每份30段正文、9个链接、A4单页及字体嵌入核对通过；四张150dpi页面逐张检查，模型/嵌入/GPU增量均为0。PR快照为北京时间2026-11-25 19:54，不是未来实时合并保证。

复现须在服务器独立环境完成：

1. `build_role_briefs.py --root <仓库根> --content <content.json> --evidence <evidence.json> --output <新HTML目录>`，先验证全部来源字节再构建。
2. `prepare_font.py --font <原始NotoSansCJKsc-Regular.otf> --html <HTML目录> --output <新字体目录>`，保留CFF glyph IDs、重命名派生字体，原文件不改。
3. 使用Playwright/Chromium运行`render_role_briefs.py --content <content.json> --source <HTML目录> --output <新raw目录> --font-config <新字体目录/fonts.conf>`。
4. 用pypdf执行`verify_role_briefs.py`核对并输出最终PDF，再用Poppler和`inspect_role_briefs.py`/PyMuPDF分别渲染全部页并检查。

脚本版本及实际服务器参数见阶段记录；原字体、浏览器和环境不随本目录分发。HTML与PDF来自同一份正文；修改后需要重新构建、核对和渲染。附件是项目经历材料，投递前应按实际承担和掌握内容使用。
