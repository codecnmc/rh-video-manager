# 本地中文配音小模型测试

当前已下载 Kokoro-82M INT8 v1.0，使用 sherpa-onnx CPU 推理。无需 CUDA，不占用 GTX 1650 显存。运行环境、模型、下载包和测试音频均位于项目的 `.cache/local-tts/`，已被现有 `.gitignore` 排除，不进入应用安装包或版本控制。

这是独立本地模型验证，不代表应用已接通配音生成。支持预置音色、文字和语速；不支持音色克隆、自然语言情绪控制、自动匹配时间轴长度或 H3 提示词解析。生成不会上传文字或音频，不启动 HTTP 服务。

后续已补充可安装的测试插件：见 `extensions/kokoro-test/README.md`。其使用独立 Python 3.13 运行包，不依赖下面的 Python 3.8 测试 venv。打包版可通过插件命令生成 WAV，但仍没有正式语音业务页面或通用合成 IPC。

## 使用

在项目根目录 PowerShell 中运行（输出文件不得已存在）：

```powershell
./scripts/local-tts/generate.ps1 -Text '你好，新的故事开始了。' -Output '.cache/local-tts/outputs/my-voice.wav' -Voice 45 -Speed 1.0
```

语速范围为 0.5–2.0，不保证音频严格符合目标时长。文字限 1–2000 字符，建议按短句生成。

| ID | 模型音色名 |
| --- | --- |
| 45 | zf_xiaobei |
| 46 | zf_xiaoni |
| 47 | zf_xiaoxiao |
| 48 | zf_xiaoyi |
| 49 | zm_yunjian |
| 50 | zm_yunxi |
| 51 | zm_yunxia |
| 52 | zm_yunyang |

`zf` 为模型标注的中文女声，`zm` 为中文男声。名单来自上游模型文档，不对应用户克隆音色。

## 环境与来源

- 独立虚拟环境：`.cache/local-tts/venv`，基于本机已有 Python 3.8 x64；没有改动全局 Python 或 Anaconda。
- 固定依赖见同目录 `requirements.txt`；本次安装使用机器已配置的清华 PyPI 镜像。sherpa-onnx / core 为 Apache-2.0，NumPy 为 BSD-3-Clause。
- Python 3.8 已结束上游维护，此环境仅用于本地测试。正式插件打包前应迁移到受支持的隔离运行时。
- 上游运行库：[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)，使用 1.13.8。
- 原始模型：[hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)，82M 参数，Apache-2.0。
- [sherpa-onnx 模型使用文档](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html)。
- [本次模型压缩包](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2)，保留在 `.cache/local-tts/downloads/`，约 126 MiB。
- [对应量化仓库固定修订](https://huggingface.co/csukuangfj/kokoro-int8-multi-lang-v1_0/tree/2a360693d79b88b49b88e29aec2b53577f41f206)。下载后模型和音色文件 SHA256 均与该修订 LFS 元数据一致；未克隆完整仓库。
- 模型包自带 `LICENSE` 为 Apache-2.0。包中还包含 eSpeak NG 发音资源（GPL-3.0 系列）及分词资源；未来再分发须另行整理这些第三方资源的许可证与归属，不能只按模型许可打包。

| 文件 | SHA256 |
| --- | --- |
| 压缩包 | `4c3052abaa60943a341f193888cf6abd68787dae6ab8ae5c925a706caa247e4e` |
| model.int8.onnx | `4b86207ef680e394d8343bee22dfc4c512e5c707c6d9578e3f35ab09bffd6b36` |
| voices.bin | `1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29` |

模型权重为 114,203,756 字节，音色表为 28,200,960 字节。当前运行文件、原始下载包和环境总占用约 429 MiB。`.cache` 并非永久存储承诺，清理前应保留需要的音频；环境删除后需重新创建 venv、安装固定依赖并恢复模型包。

Windows 的底层 eSpeak 库无法读取含中文的绝对目录，因此脚本在项目根目录下使用 ASCII 相对模型路径。输出路径仍按调用时的工作目录解析，拒绝覆盖已有文件。
