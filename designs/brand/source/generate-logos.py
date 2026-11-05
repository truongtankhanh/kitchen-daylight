import math, os, sys, json
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

# Usage: python generate-logos.py /path/to/Nunito[wght].ttf   (writes the SVG files next to this folder)
FONT = sys.argv[1] if len(sys.argv) > 1 else os.environ['NUNITO_TTF']
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..') + os.sep
SYMBOL_OUT = os.environ.get('KD_SYMBOL_OUT')

_cache = {}
def font(w):
    if w not in _cache:
        _cache[w] = instancer.instantiateVariableFont(TTFont(FONT), {'wght': w}, inplace=False)
    return _cache[w]

def run(text, w, size, x, y, tracking=0.0):
    f = font(w); upm = f['head'].unitsPerEm; s = size / upm
    gs = f.getGlyphSet(); cmap = f.getBestCmap(); hm = f['hmtx']
    d = ''; cx = x
    for ch in text:
        gn = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
        gs[gn].draw(TransformPen(pen, (s, 0, 0, -s, cx, y)))
        d += pen.getCommands()
        cx += hm[gn][0] * s + tracking
    return d, cx - x - tracking

def cap(w, size):
    f = font(w); return f['OS/2'].sCapHeight * size / f['head'].unitsPerEm

# ---- palette (Water element: navy, ocean blue, aqua; no yellow or brown) ----
NAVY = '#0B2A52'; DEEP = '#0E3463'; BLUE = '#1560C8'; SKY = '#4F9BFF'; AQUA1 = '#A6F3FF'; AQUA2 = '#38C3F0'

def tile_defs(p):
    return f'''<linearGradient id="{p}-tile" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{SKY}"/><stop offset=".5" stop-color="{BLUE}"/><stop offset="1" stop-color="{DEEP}"/></linearGradient>
<linearGradient id="{p}-gloss" x1="0" y1="0" x2="0" y2="34" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="{p}-rim" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
<radialGradient id="{p}-sun" cx=".5" cy=".38" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#DFF3FF"/><stop offset="1" stop-color="#9ED8FF"/></radialGradient>
<radialGradient id="{p}-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#BFEFFF" stop-opacity=".75"/><stop offset="1" stop-color="#BFEFFF" stop-opacity="0"/></radialGradient>'''

def rays(cx, cy, r1, r2, n, width, color, opacity):
    out = ''
    for i in range(n):
        t = math.radians(i * 360 / n)
        out += f'<path d="M{cx + r1 * math.cos(t):.2f} {cy + r1 * math.sin(t):.2f}L{cx + r2 * math.cos(t):.2f} {cy + r2 * math.sin(t):.2f}"/>'
    return f'<g fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" opacity="{opacity}">{out}</g>'

def mark_body(p, flat=False):
    # "KD" in Nunito ExtraBold, outlined, set inside a sun disc with a ring of rays
    size = 21.0
    d, wd = run('KD', 800, size, 0, 0, tracking=-0.3)
    ch = cap(800, size)
    x0 = 32 - wd / 2; base = 32 + ch / 2
    d, wd = run('KD', 800, size, x0, base, tracking=-0.3)
    if flat:
        # favicon: 8 thicker rays, no gradients or shadows
        return f'''<rect width="64" height="64" rx="16" fill="{BLUE}"/>
{rays(32, 32, 21, 28, 8, 4, '#fff', 1)}
<circle cx="32" cy="32" r="17.5" fill="#fff"/>
<path d="{d}" fill="{DEEP}"/>'''
    return f'''<rect width="64" height="64" rx="16" fill="url(#{p}-tile)"/>
<path d="M0 16A16 16 0 0 1 16 0h32a16 16 0 0 1 16 16v14C48 36 16 36 0 30Z" fill="url(#{p}-gloss)"/>
<rect x=".6" y=".6" width="62.8" height="62.8" rx="15.4" fill="none" stroke="url(#{p}-rim)" stroke-width="1.2"/>
<circle cx="32" cy="32" r="29" fill="url(#{p}-glow)"/>
<g transform="translate(0 1.4)">{rays(32, 32, 21.2, 27.6, 12, 3, '#061C3C', .35)}</g>
{rays(32, 32, 21.2, 27.6, 12, 3, '#fff', .92)}
<circle cx="32" cy="33.8" r="17.6" fill="#061C3C" opacity=".38"/>
<circle cx="32" cy="32" r="17.6" fill="url(#{p}-sun)"/>
<circle cx="32" cy="32" r="17.1" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".8"/>
<g transform="translate(0 .9)" fill="#fff" opacity=".7"><path d="{d}"/></g>
<path d="{d}" fill="{DEEP}"/>'''

def mark_svg(flat=False, title='Kitchen Daylight'):
    p = 'kd'
    defs = '' if flat else f'<defs>{tile_defs(p)}</defs>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="{title}">\n<title>{title}</title>\n{defs}\n{mark_body(p, flat)}\n</svg>\n'

def word_paths(size, x, y, dark):
    # "Kitchen" ExtraBold + "Daylight" Bold, with a soft layered shadow added later for depth
    d1, w1 = run('Kitchen', 800, size, x, y, tracking=0.0)
    gap = size * 0.22
    d2, w2 = run('Daylight', 700, size, x + w1 + gap, y, tracking=0.2)
    return d1 + d2, w1 + gap + w2

def word_group(size, x, y, dark, gid):
    d, w = word_paths(size, x, y, dark)
    sh = '#000' if dark else BLUE
    so = '.35' if dark else '.2'
    g = f'''<g transform="translate(0 {size*0.04:.2f})" fill="{sh}" opacity="{so}"><path d="{d}"/></g>
<path d="{d}" fill="url(#{gid})"/>'''
    return g, w

def grad_text(gid, y1, y2, dark):
    a, b = ('#FFFFFF', '#BCD8FF') if dark else (DEEP, BLUE)
    return f'<linearGradient id="{gid}" x1="0" y1="{y1:.1f}" x2="0" y2="{y2:.1f}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'

def horizontal(dark=False):
    size = 34.0
    ch = cap(800, size)
    base = 32 + ch / 2          # centre cap height on the mark's vertical centre
    g, w = word_group(size, 78, base, dark, 'kd-wt')
    W = 78 + w + 6
    defs = tile_defs('kd') + grad_text('kd-wt', base - ch, base, dark)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} 70" role="img" aria-label="Kitchen Daylight">
<title>Kitchen Daylight</title>
<defs>{defs}</defs>
<g transform="translate(0 3)">{mark_body('kd')}</g>
<g transform="translate(0 3)">{g}</g>
</svg>
'''

def stacked(dark=False):
    size = 34.0
    ch = cap(800, size)
    d, w = word_paths(size, 0, 0, dark)
    W = max(w, 96) + 24
    mx = (W - 96) / 2
    base = 96 + 22 + ch
    g, _ = word_group(size, (W - w) / 2, base, dark, 'kd-wt')
    defs = tile_defs('kd') + grad_text('kd-wt', base - ch, base, dark)
    H = base + 14
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" role="img" aria-label="Kitchen Daylight">
<title>Kitchen Daylight</title>
<defs>{defs}</defs>
<g transform="translate({mx:.1f} 4) scale(1.5)">{mark_body('kd')}</g>
{g}
</svg>
'''

def wordmark(dark=False):
    size = 40.0
    ch = cap(800, size)
    base = ch + 6
    g, w = word_group(size, 4, base, dark, 'kd-wt')
    defs = grad_text('kd-wt', base - ch, base, dark)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w+8:.0f} {base+14:.0f}" role="img" aria-label="Kitchen Daylight">
<title>Kitchen Daylight</title>
<defs>{defs}</defs>
{g}
</svg>
'''

files = {
    'logo-mark.svg': mark_svg(),
    'logo-mark-small.svg': mark_svg(flat=True),
    'logo-horizontal.svg': horizontal(False),
    'logo-horizontal-on-dark.svg': horizontal(True),
    'logo-stacked.svg': stacked(False),
    'logo-stacked-on-dark.svg': stacked(True),
    'logo-wordmark.svg': wordmark(False),
    'logo-wordmark-on-dark.svg': wordmark(True),
}
for n, c in files.items():
    open(OUT + n, 'w', encoding='utf-8').write(c)
# inner markup of the full mark, for reuse as an inline <symbol>
sym = f'<symbol id="kd-mark" viewBox="0 0 64 64"><defs>{tile_defs("kd")}</defs>{mark_body("kd")}</symbol>'
if SYMBOL_OUT:
    open(SYMBOL_OUT, 'w', encoding='utf-8').write(sym)
print({n: len(c) for n, c in files.items()})
