/**
 * Writes a PDF made of text — a statement, a letter — with nothing but the
 * base-14 Helvetica fonts every PDF reader carries, so no font file has to
 * be embedded and the whole thing is string concatenation.
 *
 * Text is encoded as WinAnsi, which is what those fonts understand: ASCII
 * plus Latin-1 plus a few typographic marks (dashes, curly quotes). Anything
 * outside that becomes a question mark rather than a broken glyph.
 *
 * The document is laid out top to bottom on US Letter pages by a small
 * flow: paragraphs, table rows, rules, gaps, with a page break wherever
 * the next line wouldn't fit. Widths come from the fonts' own metrics, so
 * right-aligned money lines up.
 *
 * Pure: no DOM, no Node-only APIs, bytes out. lib/pdf.ts (image pages) is
 * left alone; this is its counterpart for words.
 */

export const LETTER = { width: 612, height: 792 } as const;

/**
 * Glyph widths for the printable ASCII range, per 1000 units of font size,
 * from the Adobe AFM files for Helvetica and Helvetica-Bold. Index 0 is
 * the space (0x20).
 */
// prettier-ignore
const HELVETICA: number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// prettier-ignore
const HELVETICA_BOLD: number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Typographic characters WinAnsi has a slot for, and their widths (regular, bold). */
const EXTRA: Record<number, { code: number; w: number; wb: number }> = {
  0x2013: { code: 0x96, w: 556, wb: 556 }, // en dash
  0x2014: { code: 0x97, w: 1000, wb: 1000 }, // em dash
  0x2018: { code: 0x91, w: 222, wb: 278 }, // ‘
  0x2019: { code: 0x92, w: 222, wb: 278 }, // ’
  0x201c: { code: 0x93, w: 333, wb: 500 }, // “
  0x201d: { code: 0x94, w: 333, wb: 500 }, // ”
  0x2022: { code: 0x95, w: 350, wb: 350 }, // •
  0x2026: { code: 0x85, w: 1000, wb: 1000 }, // …
  0x20ac: { code: 0x80, w: 556, wb: 556 }, // €
  0x2212: { code: 0x2d, w: 333, wb: 333 }, // minus sign → hyphen
};

/** Latin-1 letters are mostly as wide as their plain forms; this is close enough for a right edge. */
const LATIN1_WIDTH = 556;

/** One character as a WinAnsi byte, or 0x3f ("?") when there isn't one. */
export function winAnsiByte(codePoint: number): number {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint;
  const extra = EXTRA[codePoint];
  return extra ? extra.code : 0x3f;
}

/** The width of a string in points at `size`, in the regular or bold face. */
export function textWidth(text: string, size: number, bold = false): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp <= 0x7e) units += table[cp - 0x20];
    else if (EXTRA[cp]) units += bold ? EXTRA[cp].wb : EXTRA[cp].w;
    else if (cp >= 0xa0 && cp <= 0xff) units += LATIN1_WIDTH;
    else units += table[0x3f - 0x20];
  }
  return (units * size) / 1000;
}

/** A PDF literal string: WinAnsi bytes, with the three characters PDF treats specially escaped. */
export function pdfLiteral(text: string): string {
  let out = "(";
  for (const ch of text) {
    const b = winAnsiByte(ch.codePointAt(0)!);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b < 0x20 || b > 0x7e) out += `\\${b.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(b);
  }
  return out + ")";
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

/** Info-dictionary strings may hold anything: non-ASCII goes out as UTF-16 like lib/pdf.ts does. */
function infoString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = "FEFF";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, "0") + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
    } else hex += code.toString(16).padStart(4, "0");
  }
  return `<${hex.toUpperCase()}>`;
}

export type TextStyle = {
  size?: number;
  bold?: boolean;
  /** 0 is black, 1 is white. */
  grey?: number;
  align?: "left" | "right" | "center";
};

export type Cell = TextStyle & { text: string };

export type Column = {
  /** Points, or a share of the remaining width when `flex` is set instead. */
  width?: number;
  flex?: number;
  align?: "left" | "right" | "center";
};

/** Space between the bottom of one line and the baseline of the next, as a multiple of the size. */
const LEADING = 1.35;

/**
 * A document being laid out. Content is added top to bottom; each call
 * knows how tall it is and starts a new page when it wouldn't fit.
 */
export class TextDocument {
  private readonly margin: number;
  private readonly pages: string[][] = [];
  private y = 0;
  private readonly title: string;
  private readonly created: Date;

  constructor(opts: { title?: string; created?: Date; margin?: number } = {}) {
    this.margin = opts.margin ?? 54;
    this.title = opts.title ?? "";
    this.created = opts.created ?? new Date(0);
    this.newPage();
  }

  /** The width between the margins. */
  get contentWidth(): number {
    return LETTER.width - 2 * this.margin;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  newPage(): this {
    this.pages.push([]);
    this.y = LETTER.height - this.margin;
    return this;
  }

  private ensure(height: number) {
    if (this.y - height < this.margin) this.newPage();
  }

  private ops(): string[] {
    return this.pages[this.pages.length - 1];
  }

  private place(text: string, x: number, baseline: number, style: TextStyle, width: number) {
    const size = style.size ?? 11;
    const bold = style.bold ?? false;
    const w = textWidth(text, size, bold);
    const at = style.align === "right" ? x + width - w : style.align === "center" ? x + (width - w) / 2 : x;
    const grey = style.grey ?? 0;
    this.ops().push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${grey.toFixed(2)} g ${at.toFixed(2)} ${baseline.toFixed(2)} Td ${pdfLiteral(text)} Tj ET`
    );
  }

  /** Breaks a string into lines no wider than `width`, on spaces where it can. */
  wrap(text: string, width: number, size: number, bold = false): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (textWidth(candidate, size, bold) <= width || !line) line = candidate;
        else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /** A paragraph across the full width, wrapped. */
  text(text: string, style: TextStyle = {}): this {
    const size = style.size ?? 11;
    const lines = this.wrap(text, this.contentWidth, size, style.bold);
    for (const line of lines) {
      const height = size * LEADING;
      this.ensure(height);
      this.y -= size;
      this.place(line, this.margin, this.y, style, this.contentWidth);
      this.y -= height - size;
    }
    return this;
  }

  /**
   * One row of a table. Each cell is wrapped inside its column; the row is
   * as tall as its tallest cell, and moves to the next page whole.
   */
  row(cells: Cell[], columns: Column[], opts: { padding?: number } = {}): this {
    const padding = opts.padding ?? 4;
    const fixed = columns.reduce((s, c) => s + (c.width ?? 0), 0);
    const flexTotal = columns.reduce((s, c) => s + (c.width ? 0 : (c.flex ?? 1)), 0);
    const spare = Math.max(0, this.contentWidth - fixed);
    const widths = columns.map((c) => c.width ?? (spare * (c.flex ?? 1)) / flexTotal);
    const wrapped = cells.map((cell, i) => this.wrap(cell.text, widths[i] - 2, cell.size ?? 11, cell.bold));
    const size = Math.max(...cells.map((c) => c.size ?? 11));
    const lineHeight = size * LEADING;
    const height = Math.max(...wrapped.map((w) => w.length)) * lineHeight + padding * 2;
    this.ensure(height);
    const top = this.y - padding;
    let x = this.margin;
    cells.forEach((cell, i) => {
      const align = cell.align ?? columns[i].align ?? "left";
      wrapped[i].forEach((line, n) => {
        this.place(line, x, top - size - n * lineHeight, { ...cell, align }, widths[i]);
      });
      x += widths[i];
    });
    this.y -= height;
    return this;
  }

  /** A horizontal line across the content width. */
  rule(opts: { weight?: number; grey?: number } = {}): this {
    this.ensure(4);
    const y = this.y - 2;
    this.ops().push(
      `${(opts.grey ?? 0).toFixed(2)} G ${(opts.weight ?? 0.6).toFixed(2)} w ${this.margin} ${y.toFixed(2)} m ${(
        LETTER.width - this.margin
      ).toFixed(2)} ${y.toFixed(2)} l S`
    );
    this.y -= 4;
    return this;
  }

  gap(points: number): this {
    this.y -= points;
    if (this.y < this.margin) this.newPage();
    return this;
  }

  /** The finished file. */
  build(): Uint8Array {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (s: string | Uint8Array) => {
      const b = typeof s === "string" ? enc.encode(s) : s;
      parts.push(b);
      length += b.length;
    };
    const obj = (n: number, body: string, stream?: Uint8Array) => {
      offsets[n] = length;
      push(`${n} 0 obj\n${body}\n`);
      if (stream) {
        push("stream\n");
        push(stream);
        push("\nendstream\n");
      }
      push("endobj\n");
    };

    // 1 catalog, 2 pages, 3 info, 4 Helvetica, 5 Helvetica-Bold, then per page: page, content.
    const first = 6;
    const pageIds = this.pages.map((_, i) => first + i * 2);
    push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${this.pages.length} >>`);
    obj(
      3,
      `<< /Producer (Rent Roll) ${this.title ? `/Title ${infoString(this.title)} ` : ""}/CreationDate ${pdfDate(this.created)} >>`
    );
    obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    this.pages.forEach((ops, i) => {
      const [pageId, contentId] = [pageIds[i], pageIds[i] + 1];
      obj(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LETTER.width} ${LETTER.height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents ${contentId} 0 R >>`
      );
      // Latin-1 bytes in the literals must go out as single bytes, not UTF-8.
      const content = Uint8Array.from(ops.join("\n"), (c) => c.charCodeAt(0) & 0xff);
      obj(contentId, `<< /Length ${content.length} >>`, content);
    });

    const count = first + this.pages.length * 2;
    const xref = length;
    push(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}
