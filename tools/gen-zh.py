# -*- coding: utf-8 -*-
"""生成 cloud/web/src/zh.js：简体中文/日文新字体 → 繁体 的单字映射。

数据源（OpenCC, Apache-2.0）：
  STCharacters.txt  简→繁（取第一个繁体变体）
  JPVariants.txt    繁→日文新字体（此处反转成 日→繁）
只保留 BMP 内的单字映射（JS 字符串按 UTF-16 索引，避开代理对）。
用法：python tools/gen-zh.py <STCharacters.txt> <JPVariants.txt>
"""
import io
import json
import sys
from pathlib import Path

st_path, jp_path = sys.argv[1], sys.argv[2]
out_path = Path(__file__).resolve().parents[1] / "cloud" / "web" / "src" / "zh.js"

def json_str(s):
    return json.dumps(s, ensure_ascii=False)

mapping = {}

def bmp(ch):
    return len(ch) == 1 and ord(ch) <= 0xFFFF

for line in io.open(st_path, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = line.split("\t")
    if len(parts) < 2:
        continue
    simp, trads = parts[0], parts[1].split(" ")
    trad = trads[0]
    if bmp(simp) and bmp(trad) and simp != trad:
        mapping[simp] = trad

jp_added = 0
for line in io.open(jp_path, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = line.split("\t")
    if len(parts) < 2:
        continue
    trad, jps = parts[0], parts[1].split(" ")
    for jp in jps:
        # 反转：日文新字体 → 繁体；简→繁表优先，不覆盖
        if bmp(jp) and bmp(trad) and jp != trad and jp not in mapping:
            mapping[jp] = trad
            jp_added += 1

pairs = sorted(mapping.items())
src = "".join(k for k, _ in pairs)
dst = "".join(v for _, v in pairs)

js = u'''// 自动生成，勿手改（tools/gen-zh.py，数据源 OpenCC，Apache-2.0）。
// 简体中文 / 日文新字体 → 繁体 的单字映射，用于搜索归一化：
// 「山下达郎」「浜田省吾」这样的输入都能命中曲库里的原名。
const FROM = %s
const TO = %s
let map = null

/** 搜索归一化：小写 + 简体/日文新字体统一折算成繁体。 */
export function zhNorm(s) {
  if (!map) {
    map = new Map()
    for (let i = 0; i < FROM.length; i++) map.set(FROM[i], TO[i])
  }
  let out = ""
  for (const ch of String(s).toLowerCase()) out += map.get(ch) || ch
  return out
}
''' % (json_str(src), json_str(dst))

io.open(out_path, "w", encoding="utf-8", newline="\n").write(js)
print("pairs:", len(pairs), "(jp added:", jp_added, ") ->", out_path)
