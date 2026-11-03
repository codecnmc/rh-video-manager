"""One-shot offline worker. The runtime root is the working directory."""

import io
import json
import os
from pathlib import Path
import sys
import threading
import wave

import numpy as np
import sherpa_onnx


def watch_parent():
  # 插件退出或被终止时管道关闭，避免 Python 模型进程遗留。
  os.read(sys.stdin.fileno(), 1)
  os._exit(2)


def main():
  line = sys.stdin.buffer.readline(8193)
  if len(line) > 8192:
    raise ValueError("Request too large")
  request = json.loads(line)
  text = request["text"]
  voice = request["voice"]
  speed = request["speed"]
  if not isinstance(text, str) or not text.strip() or len(text) > 120:
    raise ValueError("Invalid text")
  if type(voice) is not int or voice not in range(45, 53) or not isinstance(speed, (int, float)) or not 0.5 <= speed <= 2:
    raise ValueError("Invalid voice or speed")
  threading.Thread(target=watch_parent, daemon=True).start()
  # ASCII 相对路径兼容位于中文目录中的独立运行包。
  model = Path("model")
  config = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
      kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
        model=str(model / "model.int8.onnx"), voices=str(model / "voices.bin"),
        tokens=str(model / "tokens.txt"), data_dir=str(model / "espeak-ng-data"),
        lexicon=",".join(str(model / name) for name in ["lexicon-us-en.txt", "lexicon-zh.txt"]),
      ), provider="cpu", num_threads=2,
    ),
    rule_fsts=",".join(str(model / name) for name in ["date-zh.fst", "number-zh.fst"]),
    max_num_sentences=1,
  )
  if not config.validate():
    raise ValueError("Invalid model configuration")
  tts = sherpa_onnx.OfflineTts(config)
  generation = sherpa_onnx.GenerationConfig()
  generation.sid = voice
  generation.speed = speed
  audio = tts.generate(text, generation)
  samples = np.asarray(audio.samples)
  if samples.size == 0 or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.00001:
    raise ValueError("Invalid generated audio")
  buffer = io.BytesIO()
  with wave.open(buffer, "wb") as writer:
    writer.setnchannels(1)
    writer.setsampwidth(2)
    writer.setframerate(audio.sample_rate)
    writer.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
  sys.stdout.buffer.write(buffer.getvalue())
  sys.stdout.buffer.flush()


if __name__ == "__main__":
  main()
