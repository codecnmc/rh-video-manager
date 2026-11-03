# 第三方来源

此目录中的适配代码与 `synthesize.py` 是本项目的测试插件，不包含模型、Python 或第三方二进制。配套运行目录独立存放，不随 Electron 安装包嵌入。

配套运行目录使用：

- CPython 3.13.9 Windows x64 embeddable，Python Software Foundation License；保留 `python/LICENSE.txt`。来源：https://www.python.org/ftp/python/3.13.9/python-3.13.9-embed-amd64.zip 。ZIP SHA256：`91d828c2da3a029b41699e918674a0cb379c02cf20dab9c501306885f837402a`。
- sherpa-onnx 与 sherpa-onnx-core 1.13.8，Apache-2.0；保留 wheel 的 dist-info/licenses。来源：https://pypi.org/project/sherpa-onnx/1.13.8/ 、https://github.com/k2-fsa/sherpa-onnx 。
- NumPy 2.2.6，BSD-3-Clause 及其二进制所附第三方许可；保留 wheel 的完整 dist-info/licenses。来源：https://pypi.org/project/numpy/2.2.6/ 。
- Kokoro-82M INT8 v1.0，Apache-2.0；保留 `model/LICENSE`。上游：https://huggingface.co/hexgrad/Kokoro-82M ，量化包：https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2 。权重和音色 SHA256 见本项目 `scripts/local-tts/README.md`。
- 模型包 eSpeak NG 发音资源与运行库相关组件遵循 GPL-3.0 及其组件声明；许可随运行包 `licenses/espeak-ng-COPYING` 保留。源码：https://github.com/espeak-ng/espeak-ng ，sherpa-onnx 的构建集成：https://github.com/k2-fsa/sherpa-onnx/tree/master/cmake 。
- 模型包 cppjieba/jieba 词典与相关资源，MIT 系列；保留 `licenses/cppjieba-LICENSE` 及原始 dict 说明。源码：https://github.com/yanyiwu/cppjieba 、https://github.com/fxsjy/jieba 。

该运行目录目前用于用户本机的接入测试，不应直接作为完成第三方合规审查的公开发行包。对外再分发二进制前，需按实际依赖构建版本整理对应源码、版权归属、许可证和 GPL 分发义务；模型的 Apache 许可不覆盖所有附属组件。
