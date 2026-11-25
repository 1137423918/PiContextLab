# 派生核心独立分发验证

本轮验证core12作为独立npm包的交付，不是新框架算法、模型研究或业务项目。原生17个源码文件与e153d85一致，宿主/测试/界面及旧实验记录未改；只补齐发布清单、包内说明、独立消费示例和验证脚本。

## 可安装产物

- [核心tarball](earendil-works-pi-agent-core-1.6.0-contextlab.12.tgz)：`@earendil-works/pi-agent-core@1.6.0-contextlab.12`，非官方MIT派生，未发布至上游npm账号。
- [分发清单](distribution.json)、[npm原始打包清单](npm-pack.json)、[包内容与源码核对](packaged-source-proof.json)。产物154,365字节、89个文件；许可证和UPSTREAM身份保留，Pi AI/schema均固定1.6.0。
- SHA256：`68ef3f3aa1f71eab0216da91e8e70b0af287d6e139bf6c13dea53bfd6d773198`。npm给出的SHA512 SRI也与实际产物核对一致；哈希是字节身份核对，不是额外签名或部署认证。

## 实际发现与修复

第一轮打包包含声明映射，却未包含`src/`，17份`.d.ts.map`指向包外缺失文件，见[原始失败清单](runs/sdk-distribution-v1/package-audit/distribution.json)及[失败日志](runs/sdk-distribution-v1/isolated-sdk-package-consumer.log)。不能用仓库内相对导入掩盖这个分发问题。

修复将映射所需源码和README纳入包。所有17个源码及全部89个包文件均与本次构建树逐字节一致；安装后再次核对所有文件。当前`missing_map_sources`为零。核心源码、算法、运行指纹与依赖锁未改变，不额外声称一个新的算法版本。

## 仓库外消费验证

[消费结果](consumer-result.json)与[目录位置](consumer-location.json)证明消费目录位于构建仓库外，核心安装自tarball且不是symlink；未从工作区借用核心目录。

1. 在新目录生成并保存[实际消费lock](consumer-package-lock.json)，以`npm ci --ignore-scripts --no-audit --no-fund`安装，包内所有字节与tarball一致。
2. 用消费目录自身的TypeScript7.0.2和`@types/node`22.19.19编译[可复用工厂与控制示例](../../examples/sdk-consumer/)。严格类型检查启用`skipLibCheck=false`，依赖声明也检查。
3. 运行真正的Pi Agent和脚本provider，共3次合成响应。验证规范化声明与选集一致、压力外置、可选子树进入provider视图、精确回读大整数和长小数字面、完整审计原文保留；最高视图4,901字节/16KiB。

日志分别为[冻结](consumer-freeze.log)、[安装](consumer-install.log)、[类型检查和构建](consumer-typecheck-and-build.log)、[原生运行](consumer-native-runtime.log)。这些是合成集成控制，不是真实客户、模型准确率或部署完成证明；仅在本次授权Linux服务器CPU环境验证，其他平台未测试。

## 执行和复现

最终`sdk-distribution-v2`为56.912秒，owned0/GPU0，真实模型调用0。已有101项工程测试、14项浏览器及117次真实生成请求的原记录保留，本轮未重复运行闭合效果研究或追加其额度。

[源码快照](source-snapshot.tar.gz)、[快照清单](snapshot-manifest.json)、[116个当前执行/消费文件核对](source-verification.json)、[原项目lock](package-lock.json)、[两轮完整阶段记录](runs/)保留。打包时隔离源码树不带`.git`，所以`distribution.json`的`source_commit`为null；准确输入依据上述快照和逐文件哈希，不伪造已提交身份。

在授权服务器安装根仓库冻结依赖并构建核心后，使用新输出目录执行：

```bash
python scripts/verify_sdk_distribution.py /path/to/new-distribution-check
```

该命令会打包、检查许可/身份/映射、创建仓库外消费目录并安装冻结依赖、编译和执行合成控制，不读取模型密钥。接入自己的模型/宿主和应用运行流程见[接入说明](../../docs/integration.md)；简历展示见[项目说明](../../docs/project-brief.md)。
