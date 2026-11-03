"""Offline Chinese preset-voice synthesis using Kokoro INT8 and sherpa-onnx."""

import argparse
import json
import os
from pathlib import Path
import time
import wave

import numpy as np
import sherpa_onnx


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--text", required=True)
  parser.add_argument("--output", required=True)
  parser.add_argument("--voice", type=int, choices=range(45, 53), default=45)
  parser.add_argument("--speed", type=float, default=1.0)
  args = parser.parse_args()
  if not args.text.strip() or len(args.text) > 2000:
    parser.error("Text must contain 1-2000 characters.")
  if not 0.5 <= args.speed <= 2.0:
    parser.error("Speed must be between 0.5 and 2.0.")

  root = Path(__file__).resolve().parents[2]
  output = Path(args.output).resolve()
  if output.exists():
    parser.error("Output already exists; choose another filename.")
  # eSpeak 在 Windows 下不能正确读取中文绝对路径，使用 ASCII 相对路径。
  os.chdir(str(root))
  model = Path(".cache/local-tts/models/kokoro-int8-multi-lang-v1_0")
  config = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
      kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
        model=str(model / "model.int8.onnx"),
        voices=str(model / "voices.bin"),
        tokens=str(model / "tokens.txt"),
        data_dir=str(model / "espeak-ng-data"),
        lexicon=",".join(str(model / name) for name in ["lexicon-us-en.txt", "lexicon-zh.txt"]),
      ),
      provider="cpu",
      num_threads=2,
    ),
    rule_fsts=",".join(str(model / name) for name in ["date-zh.fst", "number-zh.fst"]),
    max_num_sentences=1,
  )
  if not config.validate():
    raise RuntimeError("Model configuration is invalid.")
  started = time.monotonic()
  tts = sherpa_onnx.OfflineTts(config)
  generation = sherpa_onnx.GenerationConfig()
  generation.sid = args.voice
  generation.speed = args.speed
  audio = tts.generate(args.text, generation)
  samples = np.asarray(audio.samples)
  if samples.size == 0 or not np.isfinite(samples).all():
    raise RuntimeError("The model returned empty or invalid audio.")
  peak = float(np.max(np.abs(samples)))
  if peak < 0.00001:
    raise RuntimeError("The model returned silent audio.")
  pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
  output.parent.mkdir(parents=True, exist_ok=True)
  # 独占创建输出，避免覆盖已有配音素材。
  with output.open("xb") as stream:
    with wave.open(stream, "wb") as writer:
      writer.setnchannels(1)
      writer.setsampwidth(2)
      writer.setframerate(audio.sample_rate)
      writer.writeframes(pcm.tobytes())
  print(json.dumps({
    "output": str(output),
    "voice": args.voice,
    "sampleRate": audio.sample_rate,
    "durationSeconds": round(samples.size / audio.sample_rate, 3),
    "elapsedSeconds": round(time.monotonic() - started, 3),
    "peak": round(peak, 5),
    "provider": "cpu",
  }, ensure_ascii=True))


if __name__ == "__main__":
  main()
