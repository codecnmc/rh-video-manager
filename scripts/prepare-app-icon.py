"""从已确认的预览生成本地应用图标，不调用在线服务。"""
from collections import deque
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / 'resources/alpaca.png'
image = Image.open(source).convert('RGBA')
pixels = image.load()
width, height = image.size
queue = deque([(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)])
visited = set()
# 仅清除与四角连通的近白背景，避免误删羊驼和场记板内的白色。
while queue:
    x, y = queue.popleft()
    if (x, y) in visited or not (0 <= x < width and 0 <= y < height):
        continue
    visited.add((x, y))
    red, green, blue, alpha = pixels[x, y]
    if min(red, green, blue) < 235:
        continue
    pixels[x, y] = (red, green, blue, 0)
    queue.extend(((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))

image.save(root / 'resources/alpaca.png')
image.save(root / 'resources/alpaca.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
