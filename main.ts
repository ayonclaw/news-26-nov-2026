/**
 * news-image-20261126 — one 1024x1024 poster for Thursday 26 November 2026.
 *
 * Everything here is drawn from code: the two subsetted DejaVu faces in assets/ are parsed
 * (table directory, cmap, loca/glyf) and their quadratic outlines are flattened and filled by a
 * nonzero-winding scanline pass on a surface drawn at three times the final size, then box
 * averaged down. The PNG is assembled with zlib.deflateSync and hand-computed chunk CRCs.
 * Node 22 standard library only — no packages, no canvas, no network, no system fonts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = 1024;
const AA = 3;
const HOME = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

type Color = [number, number, number];
const INK: Color = [9, 10, 11];
const PAPER: Color = [240, 238, 232];
const MUTED: Color = [141, 141, 134];
const DIM: Color = [88, 88, 84];
const EMBER: Color = [229, 148, 55];
const HAIR: Color = [48, 48, 46];

/* ------------------------------------------------------------------ bytes */

const word = (b: Buffer, o: number) => (b[o] << 8) | b[o + 1];
const sWord = (b: Buffer, o: number) => {
  const v = word(b, o);
  return v & 0x8000 ? v - 0x10000 : v;
};
const dword = (b: Buffer, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/* ------------------------------------------------------------------ faces */

type Anchor = { x: number; y: number; snapped: boolean };

class Face {
  data: Buffer;
  units: number;
  glyphs: number;
  offsets: number[];
  outlineAt: number;
  widths: number[];
  uniToGlyph: Map<number, number>;
  private shaped = new Map<number, number[][]>();

  constructor(path: string) {
    this.data = readFileSync(path);
    const dir = new Map<string, number>();
    const count = word(this.data, 4);
    for (let i = 0; i < count; i++) {
      const rec = 12 + i * 16;
      dir.set(this.data.toString('latin1', rec, rec + 4), dword(this.data, rec + 8));
    }
    const headAt = dir.get('head');
    const maxpAt = dir.get('maxp');
    const locaAt = dir.get('loca');
    const hheaAt = dir.get('hhea');
    const hmtxAt = dir.get('hmtx');
    const cmapAt = dir.get('cmap');
    if (headAt === undefined || maxpAt === undefined || locaAt === undefined) {
      throw new Error(`bad face ${path}`);
    }
    this.outlineAt = dir.get('glyf') ?? 0;
    this.units = word(this.data, headAt + 18);
    this.glyphs = word(this.data, maxpAt + 4);

    const wideLoca = sWord(this.data, headAt + 50) === 1;
    this.offsets = new Array(this.glyphs + 1);
    for (let i = 0; i <= this.glyphs; i++) {
      this.offsets[i] = wideLoca ? dword(this.data, locaAt + i * 4) : word(this.data, locaAt + i * 2) * 2;
    }

    const runCount = word(this.data, (hheaAt ?? 0) + 34);
    this.widths = new Array(this.glyphs).fill(0);
    let carried = 0;
    for (let i = 0; i < this.glyphs; i++) {
      if (i < runCount) carried = word(this.data, (hmtxAt ?? 0) + i * 4);
      this.widths[i] = carried;
    }

    this.uniToGlyph = new Map();
    const subtables = word(this.data, (cmapAt ?? 0) + 2);
    let chosen = 0;
    let rank = -1;
    for (let i = 0; i < subtables; i++) {
      const rec = (cmapAt ?? 0) + 4 + i * 8;
      const platform = word(this.data, rec);
      const encoding = word(this.data, rec + 2);
      const at = (cmapAt ?? 0) + dword(this.data, rec + 4);
      const form = word(this.data, at);
      let score = -1;
      if (form === 12) score = platform === 3 && encoding === 10 ? 4 : 3;
      else if (form === 4) score = platform === 3 && encoding === 1 ? 2 : platform === 0 ? 1 : 0;
      if (score > rank) {
        rank = score;
        chosen = at;
      }
    }
    if (chosen) this.readCmap(chosen);
  }

  private readCmap(at: number) {
    const form = word(this.data, at);
    if (form === 12) {
      const groups = dword(this.data, at + 12);
      for (let g = 0; g < groups; g++) {
        const p = at + 16 + g * 12;
        const lo = dword(this.data, p);
        const hi = dword(this.data, p + 4);
        const first = dword(this.data, p + 8);
        for (let cp = lo; cp <= hi && cp < 0x10000; cp++) this.uniToGlyph.set(cp, first + (cp - lo));
      }
      return;
    }
    const segs = word(this.data, at + 6) / 2;
    const endsAt = at + 14;
    const startsAt = endsAt + segs * 2 + 2;
    const deltasAt = startsAt + segs * 2;
    const rangeAt = deltasAt + segs * 2;
    for (let s = 0; s < segs; s++) {
      const end = word(this.data, endsAt + s * 2);
      const start = word(this.data, startsAt + s * 2);
      const delta = sWord(this.data, deltasAt + s * 2);
      const slot = rangeAt + s * 2;
      const offset = word(this.data, slot);
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        let gid = offset === 0 ? (cp + delta) & 0xffff : word(this.data, slot + offset + (cp - start) * 2);
        if (offset !== 0 && gid !== 0) gid = (gid + delta) & 0xffff;
        if (gid !== 0) this.uniToGlyph.set(cp, gid);
      }
    }
  }

  glyphOf(text: string): number {
    return this.uniToGlyph.get(text.codePointAt(0) ?? 32) ?? 0;
  }

  advance(gid: number): number {
    return this.widths[gid] ?? 0;
  }

  /** Contours of one glyph in font units (y up), composites expanded. */
  outline(gid: number, depth = 0): Anchor[][] {
    const start = this.offsets[gid] ?? 0;
    const stop = this.offsets[gid + 1] ?? start;
    if (stop <= start || depth > 3) return [];
    return this.parse(start, depth);
  }

  private parse(start: number, depth: number): Anchor[][] {
    const b = this.data;
    const base = this.outlineAt + start;
    const rings = sWord(b, base);
    if (rings < 0) return this.composite(base, depth);
    if (rings === 0) return [];
    const lastPoints: number[] = [];
    for (let i = 0; i < rings; i++) lastPoints.push(word(b, base + 10 + i * 2));
    const total = lastPoints[lastPoints.length - 1] + 1;
    let p = base + 10 + rings * 2;
    p += 2 + word(b, p);
    const flagList: number[] = [];
    while (flagList.length < total) {
      const f = b[p++];
      flagList.push(f);
      if (f & 8) {
        let repeat = b[p++];
        while (repeat-- > 0) flagList.push(f);
      }
    }
    const xs: number[] = new Array(total);
    const ys: number[] = new Array(total);
    let run = 0;
    for (let i = 0; i < total; i++) {
      const f = flagList[i];
      if (f & 2) {
        const step = b[p++];
        run += f & 16 ? step : -step;
      } else if (!(f & 16)) {
        run += sWord(b, p);
        p += 2;
      }
      xs[i] = run;
    }
    run = 0;
    for (let i = 0; i < total; i++) {
      const f = flagList[i];
      if (f & 4) {
        const step = b[p++];
        run += f & 32 ? step : -step;
      } else if (!(f & 32)) {
        run += sWord(b, p);
        p += 2;
      }
      ys[i] = run;
    }
    const out: Anchor[][] = [];
    let from = 0;
    for (const last of lastPoints) {
      const ring: Anchor[] = [];
      for (let i = from; i <= last; i++) ring.push({ x: xs[i], y: ys[i], snapped: (flagList[i] & 1) === 1 });
      out.push(ring);
      from = last + 1;
    }
    return out;
  }

  private composite(base: number, depth: number): Anchor[][] {
    const b = this.data;
    let p = base + 10;
    const merged: Anchor[][] = [];
    for (;;) {
      const flags = word(b, p);
      const child = word(b, p + 2);
      p += 4;
      let dx = 0;
      let dy = 0;
      if (flags & 1) {
        dx = sWord(b, p);
        dy = sWord(b, p + 2);
        p += 4;
      } else {
        dx = (b[p] << 24) >> 24;
        dy = (b[p + 1] << 24) >> 24;
        p += 2;
      }
      let a = 1;
      let d = 1;
      if (flags & 8) {
        a = d = sWord(b, p) / 16384;
        p += 2;
      } else if (flags & 64) {
        a = sWord(b, p) / 16384;
        d = sWord(b, p + 2) / 16384;
        p += 4;
      } else if (flags & 128) {
        a = sWord(b, p) / 16384;
        p += 2;
        d = sWord(b, p + 2) / 16384;
        p += 6;
      }
      for (const ring of this.outline(child, depth + 1)) {
        merged.push(ring.map((q) => ({ x: q.x * a + dx, y: q.y * d + dy, snapped: q.snapped })));
      }
      if (!(flags & 32)) break;
    }
    return merged;
  }

  /** Glyph contours flattened into closed polygons in font units. */
  polygons(gid: number, curves = 8): number[][] {
    const hit = this.shaped.get(gid);
    if (hit) return hit;
    const built: number[][] = [];
    for (const raw of this.outline(gid)) {
      if (!raw.length) continue;
      let begin = raw.findIndex((q) => q.snapped);
      const ring = raw.slice();
      if (begin < 0) {
        ring.push({ x: (ring[0].x + ring[1].x) / 2, y: (ring[0].y + ring[1].y) / 2, snapped: true });
        begin = ring.length - 1;
      }
      const walk = ring.slice(begin).concat(ring.slice(0, begin));
      const poly: number[] = [walk[0].x, walk[0].y];
      for (let i = 1; i <= walk.length; i++) {
        const cur = walk[i % walk.length];
        const prev = walk[(i - 1) % walk.length];
        if (cur.snapped) {
          poly.push(cur.x, cur.y);
          continue;
        }
        const after = walk[(i + 1) % walk.length];
        const to = after.snapped ? after : { x: (cur.x + after.x) / 2, y: (cur.y + after.y) / 2 };
        for (let s = 1; s <= curves; s++) {
          const t = s / curves;
          const u = 1 - t;
          poly.push(u * u * prev.x + 2 * u * t * cur.x + t * t * to.x);
          poly.push(u * u * prev.y + 2 * u * t * cur.y + t * t * to.y);
        }
      }
      built.push(poly);
    }
    this.shaped.set(gid, built);
    return built;
  }
}

/* ------------------------------------------------------------------ surface */

class Surface {
  w: number;
  h: number;
  buf: Uint8Array;

  constructor(w: number, h: number, ground: Color) {
    this.w = w;
    this.h = h;
    this.buf = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.buf[i * 3] = ground[0];
      this.buf[i * 3 + 1] = ground[1];
      this.buf[i * 3 + 2] = ground[2];
    }
  }

  /** Nonzero winding fill of a device-space polygon. */
  polygon(pts: number[], paint: Color): void {
    const n = pts.length >> 1;
    if (n < 3) return;
    let top = Infinity;
    let bottom = -Infinity;
    for (let i = 1; i < pts.length; i += 2) {
      if (pts[i] < top) top = pts[i];
      if (pts[i] > bottom) bottom = pts[i];
    }
    const rowA = Math.max(0, Math.floor(top));
    const rowB = Math.min(this.h - 1, Math.ceil(bottom));
    const hits: { at: number; way: number }[] = [];
    for (let y = rowA; y <= rowB; y++) {
      const mid = y + 0.5;
      hits.length = 0;
      for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        const ax = pts[i * 2];
        const ay = pts[i * 2 + 1];
        const bx = pts[j * 2];
        const by = pts[j * 2 + 1];
        if (ay === by) continue;
        if ((ay <= mid) === (by <= mid)) continue;
        hits.push({ at: ax + ((mid - ay) / (by - ay)) * (bx - ax), way: by > ay ? 1 : -1 });
      }
      if (hits.length < 2) continue;
      hits.sort((p, q) => p.at - q.at);
      let wind = 0;
      let from = 0;
      for (const h of hits) {
        const was = wind;
        wind += h.way;
        if (was === 0 && wind !== 0) from = h.at;
        else if (was !== 0 && wind === 0) {
          const xa = Math.max(0, Math.ceil(from - 0.5));
          const xb = Math.min(this.w - 1, Math.floor(h.at - 0.5));
          for (let x = xa; x <= xb; x++) {
            const o = (y * this.w + x) * 3;
            this.buf[o] = paint[0];
            this.buf[o + 1] = paint[1];
            this.buf[o + 2] = paint[2];
          }
        }
      }
    }
  }
}

const S = (v: number) => v * AA;
const canvas = new Surface(PAGE * AA, PAGE * AA, INK);

function slab(x: number, y: number, w: number, h: number, paint: Color): void {
  canvas.polygon([S(x), S(y), S(x + w), S(y), S(x + w), S(y + h), S(x), S(y + h)], paint);
}

function outlineBox(x: number, y: number, w: number, h: number, t: number, paint: Color): void {
  slab(x, y, w, t, paint);
  slab(x, y + h - t, w, t, paint);
  slab(x, y, t, h, paint);
  slab(x + w - t, y, t, h, paint);
}

function disc(x: number, y: number, r: number, paint: Color): void {
  const pts: number[] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    pts.push(S(x + Math.cos(a) * r), S(y + Math.sin(a) * r));
  }
  canvas.polygon(pts, paint);
}

function stroke(path: number[][], weight: number, paint: Color): void {
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / len) * (weight / 2);
    const ny = ((bx - ax) / len) * (weight / 2);
    canvas.polygon(
      [S(ax + nx), S(ay + ny), S(bx + nx), S(by + ny), S(bx - nx), S(by - ny), S(ax - nx), S(ay - ny)],
      paint,
    );
    disc(ax, ay, weight / 2, paint);
    disc(bx, by, weight / 2, paint);
  }
}

function ring(cx: number, cy: number, r: number, weight: number, paint: Color): void {
  const path: number[][] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    path.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  stroke(path, weight, paint);
}

/* ------------------------------------------------------------------ type */

class Pen {
  face: Face;
  name: string;

  constructor(file: string) {
    this.name = file;
    const local = join(HOME, 'assets', file);
    const system = join('/usr/share/fonts/truetype/dejavu', file);
    const tries = [local, system];
    let lastErr: unknown = null;
    for (const path of tries) {
      try {
        this.face = new Face(path);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`face ${file}`);
  }

  /// Width of a string in page pixels, tracking included.
  width(text: string, size: number, tracking = 0): number {
    const k = size / this.face.units;
    let total = 0;
    const chars = [...text];
    for (const ch of chars) total += this.face.advance(this.face.glyphOf(ch)) * k;
    return total + Math.max(0, chars.length - 1) * tracking;
  }

  /// Draw with its left edge at x and baseline at y; returns the end x.
  write(text: string, x: number, baseline: number, size: number, paint: Color, tracking = 0): number {
    const k = size / this.face.units;
    let cursor = x;
    for (const ch of [...text]) {
      const gid = this.face.glyphOf(ch);
      for (const poly of this.face.polygons(gid)) {
        const moved: number[] = new Array(poly.length);
        for (let i = 0; i < poly.length; i += 2) {
          moved[i] = S(cursor + poly[i] * k);
          moved[i + 1] = S(baseline - poly[i + 1] * k);
        }
        canvas.polygon(moved, paint);
      }
      cursor += this.face.advance(gid) * k + tracking;
    }
    return cursor - tracking;
  }

  /// Width-limited wrapping; a single word wider than the column is kept whole.
  split(text: string, size: number, limit: number, tracking = 0): string[] {
    const rows: string[] = [];
    let row = '';
    for (const word of text.split(' ')) {
      const test = row ? `${row} ${word}` : word;
      if (!row || this.width(test, size, tracking) <= limit) row = test;
      else {
        rows.push(row);
        row = word;
      }
    }
    if (row) rows.push(row);
    return rows;
  }
}

const heavy = new Pen('DejaVuSans-Bold.ttf');
const light = new Pen('DejaVuSans.ttf');

/* ------------------------------------------------------------------ audit */

type Box = { tag: string; x0: number; y0: number; x1: number; y1: number };
const boxes: Box[] = [];

function record(tag: string, x0: number, y0: number, x1: number, y1: number): void {
  boxes.push({ tag, x0, y0, x1, y1 });
}

/// Records the ink box of one drawn line so the layout can be checked for collisions.
function recordLine(
  font: Pen,
  tag: string,
  text: string,
  x: number,
  baseline: number,
  size: number,
  tracking = 0,
): void {
  const tail = /[gjpqy,;]/.test(text) ? 0.24 : 0.06;
  record(tag, x, baseline - size * 0.76, x + font.width(text, size, tracking), baseline + size * tail);
}

function reportLayout(): void {
  let clashes = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap =
        Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 &&
        Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
      if (overlap) {
        clashes++;
        console.log(`clash: ${a.tag} vs ${b.tag}`);
      }
    }
  }
  for (const b of boxes) {
    if (b.x0 < 0 || b.y0 < 0 || b.x1 > PAGE || b.y1 > PAGE) {
      throw new Error(`box ${b.tag} leaves the page`);
    }
    if (b.tag.startsWith('t') && (b.x1 > 976 || b.y1 > 974)) {
      throw new Error(`box ${b.tag} leaves its column`);
    }
  }
  console.log(`audit: ${boxes.length} boxes, ${clashes} clashes`);
  if (clashes) throw new Error('layout clash');
}

/* ------------------------------------------------------------------ page */

const M = 48;
const GUTTER = 18;
const COL = 456;
const COL2 = M + COL + GUTTER;
const ROW_H = 216;
const ROW_GAP = 16;
const GRID_TOP = 294;
const INNER = COL - 40;

const dateSize = (() => {
  let size = 80;
  while (
    size > 56 &&
    (heavy.width('THURSDAY 26', size) > PAGE - 2 * M - 96 ||
      heavy.width('NOVEMBER 2026', size) > PAGE - 2 * M - 96)
  ) {
    size -= 2;
  }
  return size;
})();

// header: accent dot, eyebrow, right-hand six-square motif, then the date at full weight
slab(M, 40, 7, 7, EMBER);
heavy.write('WORLD NEWS  /  DAILY EDITION', M + 17, 49, 12, MUTED, 1.7);
recordLine(heavy, 'h-eyebrow', 'WORLD NEWS  /  DAILY EDITION', M + 17, 49, 12, 1.7);
const stamp = 'VOL. 331';
heavy.write(stamp, PAGE - M - heavy.width(stamp, 11, 1.2), 49, 11, DIM, 1.2);
recordLine(heavy, 'h-stamp', stamp, PAGE - M - heavy.width(stamp, 11, 1.2), 49, 11, 1.2);

for (let i = 0; i < 6; i++) {
  slab(PAGE - M - 12, 78 + i * 16, 12, 10, i % 2 === 0 ? EMBER : HAIR);
}
const regionsTag = 'SIX REGIONS';
light.write(
  regionsTag,
  PAGE - M - 12 - light.width(regionsTag, 10) - 8,
  96 + 5 * 16,
  10,
  DIM,
  0.8,
);

const lineOne = 154;
const lineTwo = lineOne + Math.round(dateSize * 0.99);
heavy.write('THURSDAY 26', M - 2, lineOne, dateSize, PAPER);
recordLine(heavy, 'h-date1', 'THURSDAY 26', M - 2, lineOne, dateSize);
heavy.write('NOVEMBER 2026', M - 2, lineTwo, dateSize, EMBER);
recordLine(heavy, 'h-date2', 'NOVEMBER 2026', M - 2, lineTwo, dateSize);

slab(M, 262, PAGE - 2 * M, 2, EMBER);
slab(M, 269, PAGE - 2 * M, 1, HAIR);

const standfirst = 'SIX STORIES. ONE DAY. NO PHOTOGRAPHS.';
light.write(standfirst, M, 288, 14, MUTED, 0.5);
recordLine(light, 'h-standfirst', standfirst, M, 288, 14, 0.5);
const edition = 'THURSDAY EDITION / 26.11.2026';
light.write(edition, PAGE - M - light.width(edition, 12, 0.4), 288, 12, DIM, 0.4);
recordLine(light, 'h-edition', edition, PAGE - M - light.width(edition, 12, 0.4), 288, 12, 0.4);

/* ------------------------------------------------------------------ stories */

type Story = {
  region: string;
  head: string[];
  kicker: string;
  detail: string;
  mark: (x: number, y: number) => void;
};

const icons: Record<string, (x: number, y: number) => void> = {
  // a missile falling nose-down, with three trail dashes above it
  missile(x, y) {
    slab(x + 15, y + 10, 6, 16, EMBER);
    canvas.polygon([S(x + 12), S(y + 26), S(x + 24), S(y + 26), S(x + 18), S(y + 37)], EMBER);
    canvas.polygon([S(x + 15), S(y + 10), S(x + 15), S(y + 18), S(x + 7), S(y + 15)], EMBER);
    canvas.polygon([S(x + 21), S(y + 10), S(x + 21), S(y + 18), S(x + 29), S(y + 15)], EMBER);
    stroke([[x + 18, y + 8], [x + 18, y + 3]], 1.8, EMBER);
    stroke([[x + 13, y + 7], [x + 13, y + 2]], 1.4, EMBER);
    stroke([[x + 23, y + 7], [x + 23, y + 2]], 1.4, EMBER);
  },
  // refinery tank with a flare stack
  refinery(x, y) {
    stroke(
      [
        [x + 4, y + 20],
        [x + 4, y + 34],
        [x + 30, y + 34],
        [x + 30, y + 20],
      ],
      2.2,
      EMBER,
    );
    const dome: number[][] = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI + (i / 16) * Math.PI;
      dome.push([x + 17 + Math.cos(a) * 13, y + 20 + Math.sin(a) * 7]);
    }
    stroke(dome, 2.2, EMBER);
    stroke([[x + 36, y + 34], [x + 36, y + 12]], 2, EMBER);
    canvas.polygon(
      [S(x + 33), S(y + 12), S(x + 39), S(y + 12), S(x + 36), S(y + 4)],
      EMBER,
    );
  },
  // a wall with an inbound arrow — tariffs go up
  wall(x, y) {
    slab(x + 12, y + 18, 26, 18, EMBER);
    slab(x + 12, y + 24, 26, 1.8, INK);
    slab(x + 12, y + 30, 26, 1.8, INK);
    slab(x + 21, y + 18, 1.8, 6, INK);
    slab(x + 16, y + 25.8, 1.8, 4.2, INK);
    slab(x + 26, y + 25.8, 1.8, 4.2, INK);
    slab(x + 30, y + 31.8, 1.8, 4.2, INK);
    stroke(
      [
        [x + 2, y + 9],
        [x + 16, y + 9],
      ],
      2.4,
      EMBER,
    );
    stroke(
      [
        [x + 11, y + 4],
        [x + 16, y + 9],
        [x + 11, y + 14],
      ],
      2.4,
      EMBER,
    );
  },
  // a chip with a falling arrow beside it
  chip(x, y) {
    outlineBox(x + 2, y + 10, 20, 20, 2, EMBER);
    slab(x + 8, y + 16, 8, 8, EMBER);
    for (const d of [6, 12, 18]) {
      stroke([[x + 2, y + d], [x - 1, y + d]], 1.8, EMBER);
      stroke([[x + 22, y + d], [x + 25, y + d]], 1.8, EMBER);
    }
    stroke(
      [
        [x + 32, y + 6],
        [x + 32, y + 30],
      ],
      2.2,
      EMBER,
    );
    stroke(
      [
        [x + 27, y + 25],
        [x + 32, y + 30],
        [x + 37, y + 25],
      ],
      2.2,
      EMBER,
    );
  },
  // a tanker with flame over the barrel
  tanker(x, y) {
    stroke(
      [
        [x + 4, y + 18],
        [x + 4, y + 28],
        [x + 34, y + 28],
      ],
      2,
      EMBER,
    );
    const barrel: number[][] = [];
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      barrel.push([x + 14 + Math.cos(a) * 10, y + 18 - Math.sin(a) * 5]);
    }
    stroke(barrel, 2, EMBER);
    stroke([[x + 24, y + 18], [x + 24, y + 28]], 2, EMBER);
    stroke([[x + 24, y + 22], [x + 34, y + 22]], 2, EMBER);
    disc(x + 9, y + 31, 3, EMBER);
    disc(x + 26, y + 31, 3, EMBER);
    stroke(
      [
        [x + 8, y + 8],
        [x + 11, y + 14],
        [x + 14, y + 8],
      ],
      1.8,
      EMBER,
    );
    stroke(
      [
        [x + 15, y + 9],
        [x + 18, y + 15],
        [x + 21, y + 9],
      ],
      1.8,
      EMBER,
    );
  },
  // a capsule climbing past an orbit arc
  orbit(x, y) {
    canvas.polygon(
      [S(x + 18), S(y + 2), S(x + 23), S(y + 11), S(x + 13), S(y + 11)],
      EMBER,
    );
    slab(x + 13, y + 11, 10, 16, EMBER);
    canvas.polygon([S(x + 13), S(y + 21), S(x + 8), S(y + 29), S(x + 13), S(y + 27)], EMBER);
    canvas.polygon([S(x + 23), S(y + 21), S(x + 28), S(y + 29), S(x + 23), S(y + 27)], EMBER);
    disc(x + 18, y + 16, 2.4, INK);
    const arc: number[][] = [];
    for (let i = 0; i <= 14; i++) {
      const a = 0.15 + (i / 14) * 1.9;
      arc.push([x + 33 - Math.cos(a) * 10, y + 27 - Math.sin(a) * 6]);
    }
    stroke(arc, 1.8, EMBER);
    slab(x + 31, y + 3, 2, 2, EMBER);
    slab(x + 36, y + 9, 1.6, 1.6, EMBER);
  },
};

const stories: Story[] = [
  {
    region: 'EUROPE / WAR',
    head: ['Ballistic missiles', 'hit Kyiv'],
    kicker: 'Shopping centre and industrial zone',
    detail:
      'Four injured in the overnight strike; one killed in Bila Tserkva. Poland set a border no-fly zone and asked NATO to intercept.',
    mark: icons.missile,
  },
  {
    region: 'MIDDLE EAST / ENERGY',
    head: ['Houthi drones hit', 'Saudi refinery'],
    kicker: 'Ras Tanura struck; Brent up 3.5% to $94.61',
    detail:
      "Drones also hit Riyadh's financial district. Two ships struck Iranian mines in the Strait of Hormuz.",
    mark: icons.refinery,
  },
  {
    region: 'NORTH AMERICA / TRADE',
    head: ['US tariffs', 'on 14 partners'],
    kicker: '20-40% capacity tariffs proposed',
    detail:
      'Trump named China, Japan and the EU despite midterm losses; Brazil was singled out with a 10% duty on Embraer jets and a sugar levy.',
    mark: icons.wall,
  },
  {
    region: 'NORTH AMERICA / TECH',
    head: ['S&P puts Nvidia on', 'downgrade watch'],
    kicker: 'Shares fall almost 4%',
    detail:
      "The agency cited weak board oversight after Jensen Huang's resignation-and-return saga; world stocks slipped on thin holiday trade.",
    mark: icons.chip,
  },
  {
    region: 'AFRICA / DISASTER',
    head: ['Cairo tanker fire', 'kills 31'],
    kicker: 'Ring Road, Al-Warraq, Giza',
    detail:
      'A fuel tanker overturned on the ring road: at least 31 dead, 21 hurt and two dozen vehicles burned.',
    mark: icons.tanker,
  },
  {
    region: 'ASIA / SPACE',
    head: ['First Pakistani', 'astronaut in orbit'],
    kicker: 'Shenzhou-24 docks at Tiangong',
    detail:
      "Muhammad Zeeshan Ali is the first foreign national on a Chinese mission. The Macy's parade was postponed for weather, a first.",
    mark: icons.orbit,
  },
];

const layoutReport: string[] = [];
let widestHead = 0;
let widestDetail = 0;

stories.forEach((story, index) => {
  const x = index % 2 === 0 ? M : COL2;
  const y = GRID_TOP + Math.floor(index / 2) * (ROW_H + ROW_GAP);
  outlineBox(x, y, COL, ROW_H, 1, HAIR);

  const num = String(index + 1).padStart(2, '0');
  slab(x + 20, y + 22, 5, 5, EMBER);
  heavy.write(num, x + 33, y + 28, 11, EMBER, 1.2);
  heavy.write(story.region, x + 63, y + 28, 11, DIM, 1.5);
  recordLine(heavy, `t${num}-region`, story.region, x + 63, y + 28, 11, 1.5);

  const headSize = 30;
  let headBase = y + 76;
  for (const row of story.head) {
    const rowWidth = heavy.width(row, headSize);
    if (rowWidth > INNER) throw new Error(`headline row too wide in tile ${num}`);
    widestHead = Math.max(widestHead, rowWidth);
    heavy.write(row, x + 20, headBase, headSize, PAPER);
    recordLine(heavy, `t${num}-head`, row, x + 20, headBase, headSize);
    headBase += 34;
  }

  const kickerBase = y + 140;
  light.write(story.kicker, x + 20, kickerBase, 15, EMBER);
  recordLine(light, `t${num}-kicker`, story.kicker, x + 20, kickerBase, 15);

  const detailRows = light.split(story.detail, 14, INNER);
  let detailBase = y + 162;
  for (const row of detailRows) {
    widestDetail = Math.max(widestDetail, light.width(row, 14));
    light.write(row, x + 20, detailBase, 14, MUTED);
    recordLine(light, `t${num}-detail`, row, x + 20, detailBase, 14);
    detailBase += 18;
  }

  story.mark(x + COL - 58, y + 8);
  record(`t${num}-icon`, x + COL - 58, y + 8, x + COL - 18, y + 48);

  const bottom = detailBase - 18 + 4;
  layoutReport.push(
    `tile ${num}: head=${story.head.length}@${headSize} detail=${detailRows.length} bottom=${bottom} limit=${y + ROW_H}`,
  );
  if (bottom > y + ROW_H - 4) throw new Error(`tile ${num} overflows`);
});

/* ------------------------------------------------------------------ footer */

slab(M, 984, PAGE - 2 * M, 1, HAIR);
light.write('WORLD NEWS BRIEF  /  26.11.2026', M, 1010, 11, DIM, 0.6);
recordLine(light, 'f-left', 'WORLD NEWS BRIEF  /  26.11.2026', M, 1010, 11, 0.6);
const credit = 'DRAWN IN CODE  /  SIX REGIONS';
light.write(credit, PAGE - M - light.width(credit, 11, 0.6), 1010, 11, DIM, 0.6);
recordLine(light, 'f-right', credit, PAGE - M - light.width(credit, 11, 0.6), 1010, 11, 0.6);

reportLayout();

/* ------------------------------------------------------------------ raster down + png */

const flat = Buffer.alloc(PAGE * PAGE * 3);
const area = AA * AA;
for (let y = 0; y < PAGE; y++) {
  for (let x = 0; x < PAGE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let sy = 0; sy < AA; sy++) {
      let at = ((y * AA + sy) * canvas.w + x * AA) * 3;
      for (let sx = 0; sx < AA; sx++) {
        r += canvas.buf[at];
        g += canvas.buf[at + 1];
        b += canvas.buf[at + 2];
        at += 3;
      }
    }
    const o = (y * PAGE + x) * 3;
    flat[o] = Math.round(r / area);
    flat[o + 1] = Math.round(g / area);
    flat[o + 2] = Math.round(b / area);
  }
}

const table = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let v = i;
  for (let bit = 0; bit < 8; bit++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
  table[i] = v;
}
function checksum(bytes: Buffer): number {
  let crc = -1;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
function be32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value >>> 0);
  return out;
}
function chunk(tag: string, body: Buffer): Buffer {
  const name = Buffer.from(tag, 'latin1');
  const crc = be32(checksum(Buffer.concat([name, body])));
  return Buffer.concat([be32(body.length), name, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(PAGE, 0);
header.writeUInt32BE(PAGE, 4);
header[8] = 8;
header[9] = 2;
header[10] = 0;
header[11] = 0;
header[12] = 0;

const stride = PAGE * 3 + 1;
const scanlines = Buffer.alloc(stride * PAGE);
for (let y = 0; y < PAGE; y++) {
  scanlines[y * stride] = 0;
  flat.copy(scanlines, y * stride + 1, y * PAGE * 3, (y + 1) * PAGE * 3);
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(scanlines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'entry.png'), png);

console.log(layoutReport.join('\n'));
console.log(
  `fit: date=${dateSize}px widestHead=${widestHead.toFixed(1)}/${INNER} widestDetail=${widestDetail.toFixed(1)}/${INNER}`,
);
console.log(JSON.stringify({ image: 'entry.png', width: PAGE, height: PAGE, bytes: png.length }));
