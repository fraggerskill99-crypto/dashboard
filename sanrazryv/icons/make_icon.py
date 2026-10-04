"""Иконки «Санитарный разрыв» из logo.svg (нужен cairosvg): python3 icons/make_icon.py"""
import cairosvg, os, io
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
svg = open(f'{here}/logo.svg', encoding='utf-8').read()
def png(px): return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=px))).convert('RGBA')
png(192).save(f'{here}/icon-192.png'); png(512).save(f'{here}/icon-512.png')
# maskable: рисунок в безопасной зоне 80%, фон до краёв
m = Image.new('RGBA', (512, 512), (229, 219, 192, 255)); m.paste(png(410), (51, 51)); m.save(f'{here}/icon-maskable-512.png')
os.makedirs(f'{here}/android', exist_ok=True)
for dn, px in dict(mdpi=48, hdpi=72, xhdpi=96, xxhdpi=144, xxxhdpi=192).items(): png(px).save(f'{here}/android/{dn}.png')
