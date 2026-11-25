# 批量检索的持久任务与恢复

处理较多查询时，中断后从头检索会重复编码。0.4.0在既有LlamaIndex批量检索上增加可选SQLite任务目录：逐题提交结果，恢复时跳过已保存题目，继续使用任务创建时的资料版本。默认不传`--state-dir`时，仍是原有一次性JSONL接口；旧`.partial`文件不能转成持久任务。

## 使用

使用[独立检索包](../packages/research-library/README.md)的Linux CPU环境、已导入的资料库和本地E5模型。输入仍为最多512行、1MiB的JSONL，每行只含唯一`id`和不超过2000字符的`query`。

```sh
extras/research-library/.venv/bin/agentlab-research search-batch \
  --queries /path/to/three-questions.jsonl --output /tmp/reading-results.jsonl \
  --store /path/to/library --model-dir /path/to/e5 \
  --state-dir /tmp/reading-batch-001 --query-attempt-limit 4 --top-k 3
```

恢复时保持原命令和所有参数，只增加`--resume`。首次运行用新任务目录和新输出文件；已有任务必须明确指定恢复，不能隐式覆盖。

```sh
extras/research-library/.venv/bin/agentlab-research search-batch \
  --queries /path/to/three-questions.jsonl --output /tmp/reading-results.jsonl \
  --store /path/to/library --model-dir /path/to/e5 \
  --state-dir /tmp/reading-batch-001 --query-attempt-limit 4 --top-k 3 --resume

extras/research-library/.venv/bin/agentlab-research batch-status \
  --state-dir /tmp/reading-batch-001
```

`batch-status`读取已提交进度，不加载模型。恢复检索的CLI仍会校验并加载本地模型；若所有结果已保存，其嵌入前向次数为零。最终文件在所有题目成功后发布，不覆盖不同内容的已有文件；发布中断后也可复用已保存结果，不重新检索。

## 恢复与额度

- 任务绑定查询文件原始字节哈希、资料库路径与捕获版本、版本清单、模型指纹、三个检索模块字节、Python及LlamaIndex/NumPy/PyTorch/Transformers版本、排序方式、top-k、输出路径和总尝试额度。其余传递依赖沿用冻结锁。改动这些绑定内容需要新任务；更新软件后不能沿用旧任务冒充相同实现。
- 默认尝试额度等于题数，可在创建时预留额外容量，上限1024。每次检索前持久预留一次，结果与完成状态在同一SQLite事务提交；失败与强杀留下的未知尝试继续占用额度，恢复不能提高原额度。上例三题留一份中断余量。
- 进程强杀发生在结果提交后，该题无需再算；发生在计算中或结果提交前，只能把旧尝试列为未知。明确恢复可消耗原额度中的剩余容量重试该题，不能保证任意中断下只执行一次。额度耗尽会保留已完成结果并停止，不自动重置账本。
- 一个任务目录只允许一个写入进程，锁由操作系统随进程退出释放。SQLite状态放在支持的本机文件系统，原资料版本也必须保留。当前是可信本机资料流程，不是多租户任务服务或硬件断电持久性证明。
- 资料库更新后，新任务使用新版本；旧任务恢复仍打开原版本并核对文件哈希。结果中的`is_current_generation`记录该条结果生成时的状态，旧结果不会因后续资料更新而重写。

这里限制的是检索尝试次数，不是通用token、费用或服务端嵌入额度。词法检索不需要神经前向，语义/RRF共用同题查询向量；外部服务和实验驱动仍需各自限制资源。不要删除或复制已关闭实验账本以重新获得额度。

## 验证记录

测试和真实模型结果分别报告在[执行证据](../evidence/batch-recovery/README.md)。此功能用于恢复和交付已有检索结果，不生成答案，也不改变SciFact或既有论文问答结果。
