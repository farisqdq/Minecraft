import { test } from "node:test";
import assert from "node:assert/strict";
import { LETTER, TextDocument, pdfLiteral, textWidth, winAnsiByte } from "../lib/pdf-text.ts";
import { ownerStatementPdf } from "../lib/owner-statement-pdf.ts";
import { statementFor } from "../lib/owners.ts";

const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

test("widths come from the Helvetica metrics", () => {
  // From the AFM: H 722, e 556, l 222, l 222, o 556 = 2278 units.
  assert.equal(textWidth("Hello", 10), 22.78);
  assert.equal(textWidth("Hello", 10, true), (722 + 556 + 278 + 278 + 611) / 100);
  assert.equal(textWidth("", 12), 0);
  assert.equal(textWidth("$1,500", 10), (556 + 556 + 278 + 556 * 3) / 100);
});

test("text is encoded as WinAnsi, with typographic marks mapped and the rest a question mark", () => {
  assert.equal(winAnsiByte("A".codePointAt(0)!), 0x41);
  assert.equal(winAnsiByte("–".codePointAt(0)!), 0x96, "en dash");
  assert.equal(winAnsiByte("é".codePointAt(0)!), 0xe9, "Latin-1 as is");
  assert.equal(winAnsiByte("−".codePointAt(0)!), 0x2d, "a minus sign becomes a hyphen");
  assert.equal(winAnsiByte("漢".codePointAt(0)!), 0x3f);
  assert.equal(pdfLiteral("a(b)c\\"), "(a\\(b\\)c\\\\)");
  assert.equal(pdfLiteral("12 Elm – Sep"), "(12 Elm \\226 Sep)", "non-ASCII bytes go out as octal escapes");
});

test("a document has two fonts, letter pages, and a cross-reference table that points at every object", () => {
  const doc = new TextDocument({ title: "Owner statement – September 2026", created: new Date("2026-09-28T12:00:00Z") });
  doc.text("Owner statement", { size: 22, bold: true }).text("September 2026").rule();
  doc.row([{ text: "Rent collected" }, { text: "$1,500", align: "right" }], [{ flex: 1 }, { width: 100 }]);
  const bytes = doc.build();
  const pdf = text(bytes);
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.match(pdf, /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.match(pdf, /\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/);
  assert.match(pdf, new RegExp(`/MediaBox \\[0 0 ${LETTER.width} ${LETTER.height}\\]`));
  assert.match(pdf, /\/Count 1/);
  assert.match(pdf, /\/Title <FEFF/, "a non-ASCII title is written as UTF-16");
  assert.match(pdf, /\/CreationDate \(D:20260928120000Z\)/);
  assert.match(pdf, /\(Owner statement\) Tj/);
  assert.match(pdf, /\/F2 22 Tf/, "the heading is bold at 22pt");
  assert.match(pdf, /%%EOF\n$/);

  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)![1]);
  assert.equal(pdf.slice(startxref, startxref + 4), "xref");
  const entries = pdf.slice(startxref).split("\n").filter((l) => /^\d{10} 00000 n $/.test(l));
  assert.equal(entries.length, 7, "catalog, pages, info, two fonts, page, content");
  entries.forEach((entry, i) => {
    const offset = Number(entry.slice(0, 10));
    assert.equal(pdf.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1}`);
  });
  // The content stream's declared length matches what's between stream and endstream.
  const m = /\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(pdf)!;
  assert.equal(Number(m[1]), m[2].length);
});

test("a right-aligned cell ends at the column's right edge", () => {
  const doc = new TextDocument({ margin: 50 });
  doc.row([{ text: "Label" }, { text: "$1,500", align: "right" }], [{ flex: 1 }, { width: 100 }]);
  const pdf = text(doc.build());
  const x = Number(/(\d+\.\d+) \d+\.\d+ Td \(\$1,500\)/.exec(pdf)![1]);
  // Content width is 512; the last column starts at 50 + 412 and is 100 wide; the text is 27.8 wide.
  assert.equal(x, +(50 + 512 - textWidth("$1,500", 11)).toFixed(2));
});

test("long text wraps and long tables spill onto a second page", () => {
  const doc = new TextDocument();
  const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  doc.text(words);
  assert.ok(doc.wrap(words, doc.contentWidth, 11).length > 5, "wrapped into several lines");
  assert.equal(doc.pageCount, 1);
  // A row is 11pt × 1.35 leading plus 8pt of padding, so about 29 fit on a page.
  for (let i = 0; i < 80; i++) doc.row([{ text: `Row ${i}` }, { text: "$1" }], [{ flex: 1 }, { width: 80 }]);
  assert.ok(doc.pageCount >= 3 && doc.pageCount <= 4, `spilled onto ${doc.pageCount} pages`);
  const pdf = text(doc.build());
  assert.match(pdf, new RegExp(`/Count ${doc.pageCount}\\b`));
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, doc.pageCount);
  assert.match(pdf, /\(Row 79\) Tj/);
});

test("the owner statement PDF carries every figure and one block per property plus the combined one", () => {
  const ledger = [
    { propertyId: "p1", type: "rent", date: "2026-09-01", amount: 1500, category: "" },
    { propertyId: "p1", type: "expense", date: "2026-09-10", amount: 120.5, category: "Repairs & Maintenance" },
  ];
  const s = statementFor(ledger, "2026-09");
  const pdf = text(
    ownerStatementPdf({
      ownerName: "Pat Investor",
      month: "2026-09",
      producedOn: "Sep 28, 2026",
      created: new Date("2026-09-28T00:00:00Z"),
      properties: [
        { name: "12 Elm St", address: "Springfield", companyName: "Elm LLC", statement: s },
        { name: "14 Elm St", address: "", companyName: "Elm LLC", statement: statementFor([], "2026-09") },
      ],
      combined: s,
    })
  );
  assert.match(pdf, /\(12 Elm St\) Tj/);
  assert.match(pdf, /\(14 Elm St\) Tj/);
  assert.match(pdf, /\(All properties together\) Tj/);
  assert.match(pdf, /\(\$1,500\) Tj/);
  assert.match(pdf, /\(\$120\.50\) Tj/);
  assert.match(pdf, /\(\$1,379\.50\) Tj/);
  assert.match(pdf, /\(Nothing was recorded for this month\.\) Tj/);
  assert.match(pdf, /\/Title <FEFF/);
});
