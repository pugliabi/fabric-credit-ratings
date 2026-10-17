"""PNG set, social images and print PDFs for the Fabric Credit Ratings logo kit.

python -I exports.py <brand-dir> <skill-scripts-dir>
"""
import os
import re
import subprocess
import sys
import tempfile

BRAND, SCRIPTS = sys.argv[1], sys.argv[2]
sys.path.insert(0, SCRIPTS)
import render_png  # noqa: E402

SVG = os.path.join(BRAND, 'svg')
GREEN = '#117865'


def viewbox(path):
    txt = open(path, encoding='utf-8').read()
    m = re.search(r'viewBox="([\d.\-]+) ([\d.\-]+) ([\d.]+) ([\d.]+)"', txt)
    return float(m.group(3)), float(m.group(4)), txt


def png(src, dst, width):
    w, h, _ = viewbox(src)
    height = max(1, round(width * h / w))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if not render_png.render(src, dst, width, height):
        raise SystemExit(f'render failed: {src}')
    return dst


# ---------- PNG set ----------
out = os.path.join(BRAND, 'png')
count = 0
for name in sorted(os.listdir(SVG)):
    src = os.path.join(SVG, name)
    stem = name[:-4]
    if '-horizontal-' in name or '-wordmark-' in name:
        widths = (1200, 2400)
    elif '-stacked-' in name:
        widths = (800, 1600)
    elif name.startswith('fcr-app-icon'):
        widths = (1024,)
    elif name.startswith('fcr-symbol-small'):
        widths = (64,)
    else:
        widths = (512, 1024, 2048)
    for w in widths:
        png(src, os.path.join(out, f'{stem}-{w}.png'), w)
        count += 1
print(f'png: {count} files')


# ---------- social ----------
def inner(path):
    """Return (viewBox w, h, children) of one of our generated SVGs, for nesting."""
    w, h, txt = viewbox(path)
    body = re.sub(r'^<svg[^>]*>', '', txt.strip()).removesuffix('</svg>')
    body = re.sub(r'<title>.*?</title>', '', body)
    return w, h, body


social = os.path.join(BRAND, 'social')
os.makedirs(social, exist_ok=True)

# Avatar: full-bleed green square, white mark inside the circle-safe zone (most platforms crop to a circle).
sw, sh, sym = inner(os.path.join(SVG, 'fcr-symbol-white.svg'))
avatar = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Fabric Credit Ratings">'
          f'<title>Fabric Credit Ratings</title><rect width="1024" height="1024" fill="{GREEN}"/>'
          f'<svg x="256" y="246" width="512" height="512" viewBox="0 0 {sw:g} {sh:g}">{sym}</svg></svg>\n')
open(os.path.join(social, 'fcr-social-avatar.svg'), 'w', encoding='utf-8').write(avatar)
png(os.path.join(social, 'fcr-social-avatar.svg'), os.path.join(social, 'fcr-social-avatar-1024.png'), 1024)

# Link preview card (Open Graph 1200 x 630): white horizontal lockup centred on green.
lw, lh, lock = inner(os.path.join(SVG, 'fcr-logo-horizontal-white.svg'))
cw = 940
ch = cw * lh / lw
card = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" role="img" aria-label="Fabric Credit Ratings">'
        f'<title>Fabric Credit Ratings</title><rect width="1200" height="630" fill="{GREEN}"/>'
        f'<svg x="{(1200 - cw) / 2:.1f}" y="{(630 - ch) / 2 - 6:.1f}" width="{cw}" height="{ch:.1f}" '
        f'viewBox="0 0 {lw:g} {lh:g}">{lock}</svg></svg>\n')
open(os.path.join(social, 'fcr-og-card.svg'), 'w', encoding='utf-8').write(card)
png(os.path.join(social, 'fcr-og-card.svg'), os.path.join(social, 'fcr-og-card-1200x630.png'), 1200)
print('social: avatar + link card')


# ---------- print PDFs (vector, RGB; the printer converts with their profile) ----------
chrome = render_png.find_chrome()
pdf_dir = os.path.join(BRAND, 'print')
os.makedirs(pdf_dir, exist_ok=True)
made = []
for stem in ('fcr-logo-horizontal-color', 'fcr-logo-horizontal-black', 'fcr-logo-stacked-color',
             'fcr-logo-stacked-black', 'fcr-symbol-color', 'fcr-symbol-black'):
    w, h, txt = viewbox(os.path.join(SVG, stem + '.svg'))
    page_w = 6.0 if 'symbol' not in stem else 2.0         # inches wide
    page_h = page_w * h / w
    html = (f'<!doctype html><meta charset="utf-8"><style>@page{{size:{page_w}in {page_h:.3f}in;margin:0}}'
            f'html,body{{margin:0}}svg{{display:block;width:{page_w}in;height:{page_h:.3f}in}}</style>{txt}')
    with tempfile.TemporaryDirectory() as tmp:
        hp = os.path.join(tmp, 'page.html')
        open(hp, 'w', encoding='utf-8').write(html)
        dst = os.path.join(pdf_dir, stem + '.pdf')
        subprocess.run([chrome, '--headless=new', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer',
                        f'--user-data-dir={os.path.join(tmp, "profile")}', f'--print-to-pdf={dst}',
                        'file:///' + hp.replace('\\', '/')], check=True, capture_output=True, timeout=120)
        made.append(os.path.basename(dst))
print('pdf:', ', '.join(made))
