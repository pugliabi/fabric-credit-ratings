"""Fabric Credit Ratings logo generator: Threaded A symbol, small and reversed cuts, wordmark and lockups.

python -I gen.py <Selawik-Semibold.ttf> <out-dir>
"""
import math
import os
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

GREEN, INK, WHITE = '#117865', '#12302a', '#ffffff'
FONT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def r(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


def poly(pts):
    return 'M' + ' L'.join(f'{r(x)} {r(y)}' for x, y in pts) + ' Z'


def symbol(L=48, T=28, G=10, top=32, base=224, half_base=92, half_apex=16, bar_mid=166,
           left_end=20, right_end=236, cx=128, dy=0.0):
    """The Threaded A. Legs are L wide (horizontally), the crossbar is T tall. The bar passes OVER the left leg
    (the leg is cut G above and below it) and UNDER the right leg (the bar stops G short, measured perpendicular)."""
    s = (half_base - half_apex) / (base - top)      # horizontal run per unit of height
    gh = G * math.sqrt(1 + s * s)                   # horizontal offset that gives a perpendicular gap of G

    def ol(y): return cx - half_base + (base - y) * s     # outer edge, left leg
    def il(y): return ol(y) + L                           # inner edge, left leg
    def orr(y): return cx + half_base - (base - y) * s    # outer edge, right leg
    def ir(y): return orr(y) - L                          # inner edge, right leg

    y1, y2 = bar_mid - T / 2, bar_mid + T / 2
    apex_in = base - (cx - il(base)) / s
    assert apex_in < y1 - G, f'counter closed: inner apex {apex_in:.1f} vs cut {y1 - G:.1f}'
    parts = [
        [(ol(base), base), (il(base), base), (il(y2 + G), y2 + G), (ol(y2 + G), y2 + G)],
        [(ol(y1 - G), y1 - G), (cx - half_apex, top), (cx + half_apex, top), (orr(base), base),
         (ir(base), base), (cx, apex_in), (il(y1 - G), y1 - G)],
        [(left_end, y1), (ir(y1) - gh, y1), (ir(y2) - gh, y2), (left_end, y2)],
        [(orr(y1) + gh, y1), (right_end, y1), (right_end, y2), (orr(y2) + gh, y2)],
    ]
    return ' '.join(poly([(x, y + dy) for x, y in p]) for p in parts)


CUTS = {
    'master': dict(),
    'reversed': dict(L=46, T=27, G=11),                # thinned for white on green or dark (irradiation)
    'small': dict(L=52, T=32, G=16, bar_mid=176, left_end=12, right_end=244),  # 32 px and below: pixel-snapped bar, longer stub
}


def svg(w, h, body, title='Fabric Credit Ratings'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {r(w)} {r(h)}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{body}</svg>\n')


# ---------- wordmark (Selawik Semibold, outlined; Selawik ships without kerning, so pairs are set by eye) ----------
font = TTFont(FONT)
GS, CMAP, HMTX, GLYF = font.getGlyphSet(), font.getBestCmap(), font['hmtx'], font['glyf']
CAP = font['OS/2'].sCapHeight
KERN = {('F', 'a'): -70, ('R', 'a'): -20, ('a', 't'): -10, ('t', 'i'): -10, ('i', 't'): -10,
        ('C', 'r'): -10, ('r', 'e'): -10}
TRACK = 0


def word(text, cap, x0, baseline):
    """Outline `text` at cap height `cap`, starting at x0 on `baseline`. Returns (path data, end x)."""
    k = cap / CAP
    x, d, prev = x0, [], None
    for ch in text:
        x += KERN.get((prev, ch), 0) * k
        g = CMAP[ord(ch)]
        pen = SVGPathPen(GS, ntos=r)
        GS[g].draw(TransformPen(pen, (k, 0, 0, -k, x, baseline)))
        if pen.getCommands():
            d.append(pen.getCommands())
        x += (HMTX[g][0] + TRACK) * k
        prev = ch
    return ' '.join(d), x


def bearings(text, cap):
    """Left side bearing of the first glyph and right side bearing of the last, so ink (not advance) aligns."""
    k = cap / CAP
    first, last = GLYF[CMAP[ord(text[0])]], CMAP[ord(text[-1])]
    return first.xMin * k, (HMTX[last][0] - GLYF[last].xMax) * k


def two_tone(cap, x0, baseline, c1, c2):
    d1, x = word('Fabric', cap, x0, baseline)
    d2, x_end = word('Credit Ratings', cap, x + HMTX[CMAP[32]][0] * 0.85 * cap / CAP, baseline)
    return f'<path fill="{c1}" d="{d1}"/><path fill="{c2}" d="{d2}"/>', x_end


def build(colors, cut):
    sym_c, w1, w2 = colors
    files = {'symbol': svg(256, 256, f'<path fill="{sym_c}" d="{symbol(**CUTS[cut], dy=-4)}"/>')}

    # Horizontal: cap height 88; the baseline sits on the crossbar's bottom edge (y 180); gap = leg width minus 4.
    cap, baseline = 88, 180
    lsb, _ = bearings('Fabric', cap)
    _, rsb = bearings('Credit Ratings', cap)
    words, x_end = two_tone(cap, 236 + 64 - lsb, baseline, w1, w2)
    files['horizontal'] = svg(x_end - rsb + 20, 256, f'<path fill="{sym_c}" d="{symbol(**CUTS[cut])}"/>' + words)

    # Stacked: symbol on top, 'Fabric' / 'Credit Ratings' centred below.
    cap2 = 64
    _, wa = word('Fabric', cap2, 0, 0)
    _, wb = word('Credit Ratings', cap2, 0, 0)
    (al, ar), (bl, br) = bearings('Fabric', cap2), bearings('Credit Ratings', cap2)
    ink_a, ink_b = wa - al - ar, wb - bl - br
    width = max(ink_b, 216) + 40
    cx = width / 2
    base1 = 224 + 40 + cap2
    base2 = base1 + round(cap2 * 1.55)
    d_a, _ = word('Fabric', cap2, cx - ink_a / 2 - al, base1)
    d_b, _ = word('Credit Ratings', cap2, cx - ink_b / 2 - bl, base2)
    height = base2 + round(cap2 * 0.32) + 20
    body = (f'<g transform="translate({r(cx - 128)} 0)"><path fill="{sym_c}" d="{symbol(**CUTS[cut])}"/></g>'
            f'<path fill="{w1}" d="{d_a}"/><path fill="{w2}" d="{d_b}"/>')
    files['stacked'] = svg(width, height, body)

    # Wordmark only.
    words, x_end = two_tone(cap, 20 - lsb, 128, w1, w2)
    files['wordmark'] = svg(x_end - rsb + 20, 160, words)
    return files


VERSIONS = {
    'color': ((GREEN, INK, GREEN), 'master'),
    'green': ((GREEN, GREEN, GREEN), 'master'),
    'ink': ((INK, INK, INK), 'master'),
    'black': (('#000000', '#000000', '#000000'), 'master'),
    'white': ((WHITE, WHITE, WHITE), 'reversed'),
}
for tag, (colors, cut) in VERSIONS.items():
    for kind, text in build(colors, cut).items():
        name = f'fcr-symbol-{tag}.svg' if kind == 'symbol' else f'fcr-logo-{kind}-{tag}.svg'
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as fh:
            fh.write(text)


def write(name, body):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as fh:
        fh.write(svg(256, 256, body))


def tile(cut, scale):
    return (f'<rect width="256" height="256" rx="56" fill="{GREEN}"/>'
            f'<g transform="translate(128 {r(128 - 256 * 0.02)}) scale({scale}) translate(-128 -128)">'
            f'<path fill="{WHITE}" d="{symbol(**CUTS[cut])}"/></g>')


write('fcr-symbol-small.svg', f'<path fill="{GREEN}" d="{symbol(**CUTS["small"])}"/>')
write('fcr-symbol-small-black.svg', f'<path fill="#000000" d="{symbol(**CUTS["small"])}"/>')
write('fcr-app-icon.svg', tile('reversed', 0.72))
write('fcr-app-icon-small.svg', tile('small', 0.86))
print('wrote', len(os.listdir(OUT)), 'files to', OUT)
