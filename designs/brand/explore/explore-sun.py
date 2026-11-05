import math, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

FONT = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
f800 = instancer.instantiateVariableFont(TTFont(FONT), {'wght': 800}, inplace=False)
gs = f800.getGlyphSet(); cmap = f800.getBestCmap(); hm = f800['hmtx']; upm = f800['head'].unitsPerEm
CAP = f800['OS/2'].sCapHeight

def glyph(ch, size, x, y):
    s = size / upm; gn = cmap[ord(ch)]
    pen = SVGPathPen(gs, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
    gs[gn].draw(TransformPen(pen, (s, 0, 0, -s, x, y)))
    bp = BoundsPen(gs); gs[gn].draw(TransformPen(bp, (s, 0, 0, -s, x, y)))
    return pen.getCommands(), bp.bounds, hm[gn][0] * s

def word(text, size, x, y, tr=0.0):
    d = ''; cx = x; bounds = []
    for ch in text:
        p, b, adv = glyph(ch, size, cx, y); d += p; bounds.append(b); cx += adv + tr
    return d, bounds, cx - x - tr

BLUE = '#1560C8'; SKY = '#4F9BFF'; DEEP = '#0E3463'; AQ1 = '#A6F3FF'; AQ2 = '#38C3F0'

DEFS = f'''<linearGradient id="t" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{SKY}"/><stop offset=".5" stop-color="{BLUE}"/><stop offset="1" stop-color="{DEEP}"/></linearGradient>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="34" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".30"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="r" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
<linearGradient id="l" x1="0" y1="14" x2="0" y2="46" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#D3E6FF"/></linearGradient>
<linearGradient id="w" x1="10" y1="0" x2="54" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{AQ1}"/><stop offset="1" stop-color="{AQ2}"/></linearGradient>
<radialGradient id="sun" cx=".5" cy=".38" r=".7"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#DFF3FF"/><stop offset="1" stop-color="#9ED8FF"/></radialGradient>
<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#BFEFFF" stop-opacity=".75"/><stop offset="1" stop-color="#BFEFFF" stop-opacity="0"/></radialGradient>'''

def tile():
    return '''<rect width="64" height="64" rx="16" fill="url(#t)"/>
<path d="M0 16A16 16 0 0 1 16 0h32a16 16 0 0 1 16 16v14C48 36 16 36 0 30Z" fill="url(#g)"/>
<rect x=".6" y=".6" width="62.8" height="62.8" rx="15.4" fill="none" stroke="url(#r)" stroke-width="1.2"/>'''

def rays(cx, cy, r1, r2, angles, width=3.0, color='#fff', op=.9):
    out = ''
    for a in angles:
        t = math.radians(a)
        x1, y1 = cx + r1 * math.cos(t), cy + r1 * math.sin(t)
        x2, y2 = cx + r2 * math.cos(t), cy + r2 * math.sin(t)
        out += f'<path d="M{x1:.2f} {y1:.2f}L{x2:.2f} {y2:.2f}"/>'
    return f'<g fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" opacity="{op}">{out}</g>'

def svg(body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Kitchen Daylight"><title>Kitchen Daylight</title><defs>{DEFS}</defs>{body}</svg>\n'

# ---------- A: the sun disc carries the KD ----------
def option_a():
    cx, cy = 32, 32
    size = 21.0
    capH = CAP * size / upm
    d, bounds, w = word('KD', size, 0, 0, -0.3)
    x0 = cx - w / 2; base = cy + capH / 2
    d, bounds, w = word('KD', size, x0, base, -0.3)
    ray = rays(cx, cy, 21.2, 27.6, [i * 30 for i in range(12)], 3.0, '#fff', .92)
    ray_sh = f'<g transform="translate(0 1.4)">{rays(cx, cy, 21.2, 27.6, [i * 30 for i in range(12)], 3.0, "#061C3C", .35)}</g>'
    return svg(tile() + f'<circle cx="{cx}" cy="{cy}" r="29" fill="url(#glow)"/>' + ray_sh + ray +
               f'<circle cx="{cx}" cy="{cy+1.8}" r="17.6" fill="#061C3C" opacity=".38"/>'
               f'<circle cx="{cx}" cy="{cy}" r="17.6" fill="url(#sun)"/>'
               f'<circle cx="{cx}" cy="{cy}" r="17.1" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".8"/>'
               f'<g transform="translate(0 .9)" fill="#fff" opacity=".7"><path d="{d}"/></g><path d="{d}" fill="{DEEP}"/>')

# ---------- B: the D is the sun (rays fan out from its curved side) ----------
def option_b():
    size = 34.0
    capH = CAP * size / upm
    dk, bk, wk = glyph('K', size, 0, 0)[0:3]
    total = glyph('K', size, 0, 0)[2] + glyph('D', size, 0, 0)[2] - 0.8
    x0 = 32 - total / 2 - 3.5
    base = 38.5
    pk, bk, wk = glyph('K', size, x0, base)
    pd, bd, wd = glyph('D', size, x0 + wk - 0.8, base)
    right = bd[2]; top = bd[1]; bottom = bd[3]
    cyd = (top + bottom) / 2; rad = (bottom - top) / 2
    cxd = right - rad
    angs = [-56, -28, 0, 28, 56]
    ray = rays(cxd, cyd, rad + 2.2, rad + 6.8, angs, 2.8, AQ1, .95)
    ray_sh = f'<g transform="translate(0 1.4)">{rays(cxd, cyd, rad + 2.2, rad + 6.8, angs, 2.8, "#061C3C", .4)}</g>'
    wave = 'M13 52.5q4.75-4.5 9.5 0t9.5 0t9.5 0t9.5 0'
    letters = pk + pd
    return svg(tile() + ray_sh + ray +
               f'<g transform="translate(0 2.4)" fill="#061C3C" opacity=".5"><path d="{letters}"/></g><path d="{letters}" fill="url(#l)"/>'
               f'<g transform="translate(0 1.6)" opacity=".4"><path d="{wave}" fill="none" stroke="#061C3C" stroke-width="3.2" stroke-linecap="round"/></g>'
               f'<path d="{wave}" fill="none" stroke="url(#w)" stroke-width="3.2" stroke-linecap="round"/>')

# ---------- C: sunrise over water, KD above the horizon ----------
def option_c():
    size = 25.0
    capH = CAP * size / upm
    d0, b0, w0 = word('KD', size, 0, 0, -0.3)
    x0 = 32 - w0 / 2; base = 11.5 + capH
    d, b, w = word('KD', size, x0, base, -0.3)
    hy = 49.0; sx = 32
    half = f'M{sx-13.5} {hy}a13.5 13.5 0 0 1 27 0Z'
    ang = [-168, -140, -112, -90, -68, -40, -12]
    ang = [180 + a for a in [-12 + 0, 0]]  # placeholder, replaced below
    angs = [200, 228, 256, 284, 312, 340]  # upward fan (screen coords: y down, so angles 180..360 are above)
    ray = rays(sx, hy, 17.2, 22.0, [a for a in [196, 224, 252, 288, 316, 344]], 2.8, AQ1, .95)
    ray_sh = f'<g transform="translate(0 1.2)">{rays(sx, hy, 17.2, 22.0, [196, 224, 252, 288, 316, 344], 2.8, "#061C3C", .35)}</g>'
    wave = f'M10 {hy+3.5}q5.5-4.5 11 0t11 0t11 0t11 0'
    return svg(tile() + ray_sh + ray +
               f'<path d="{half}" fill="#061C3C" opacity=".35" transform="translate(0 1.6)"/>'
               f'<path d="{half}" fill="url(#sun)"/>'
               f'<g transform="translate(0 2.2)" fill="#061C3C" opacity=".5"><path d="{d}"/></g><path d="{d}" fill="url(#l)"/>'
               f'<g transform="translate(0 1.4)" opacity=".4"><path d="{wave}" fill="none" stroke="#061C3C" stroke-width="3.2" stroke-linecap="round"/></g>'
               f'<path d="{wave}" fill="none" stroke="url(#w)" stroke-width="3.2" stroke-linecap="round"/>')

for name, fn in [('a-sun-disc', option_a), ('b-d-is-the-sun', option_b), ('c-sunrise', option_c)]:
    open(os.path.join(OUT, f'logo-mark-{name}.svg'), 'w', encoding='utf-8').write(fn())
print('ok')
