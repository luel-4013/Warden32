import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = resolve(root, "docs/USER-GUIDE.md");
const target = resolve(root, "docs/Warden32-User-Guide.pdf");

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 54;
const FOOT_Y = 32;
const COLS = 92;
const BODY = 8.5;
const LEAD = 11.2;

const COLOR = {
  text: [0.12, 0.15, 0.18],
  accent: [0.07, 0.52, 0.4],
  muted: [0.45, 0.52, 0.58],
  code: [0.15, 0.3, 0.3]
};

const UNICODE_MAP = {
  0x2014: 0x97,
  0x2013: 0x96,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0xb7: 0xb7,
  0x2026: 0x85
};

function sanitize(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 128) {
      out += ch;
    } else if (UNICODE_MAP[code] !== undefined) {
      out += String.fromCharCode(UNICODE_MAP[code]);
    } else if (code === 0x2192) {
      out += "->";
    } else if (code === 0x2190) {
      out += "<-";
    } else if (code === 0x2248) {
      out += "~";
    } else if (code === 0x2265) {
      out += ">=";
    } else if (code === 0x2264) {
      out += "<=";
    } else if (code === 0x25b7) {
      out += ">";
    } else if (code === 0x2317) {
      out += "#";
    } else if (code === 0x2588) {
      out += "#";
    } else {
      out += "?";
    }
  }
  return out;
}

function inline(text) {
  return sanitize(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function wrap(text, cols) {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line === "") {
      line = word;
    } else if (line.length + 1 + word.length <= cols) {
      line += " " + word;
    } else {
      lines.push(line);
      line = word;
    }
    while (line.length > cols) {
      lines.push(line.slice(0, cols));
      line = line.slice(cols);
    }
  }
  if (line !== "") lines.push(line);
  if (lines.length === 0) lines.push("");
  return lines;
}

function colsFor(size) {
  return Math.floor((PAGE_W - 2 * MARGIN) / (size * 0.6));
}

function textLine(text, opts = {}) {
  const size = opts.size ?? BODY;
  return {
    text,
    font: opts.font ?? "F1",
    size,
    color: opts.color ?? COLOR.text,
    leading: opts.leading ?? Math.round(size * 1.32 * 10) / 10,
    spaceBefore: opts.spaceBefore ?? 0
  };
}

function buildLines(markdown) {
  const raw = markdown.split("\n");
  const lines = [];
  let i = 0;

  let firstBlock = true;
  const spacer = () => lines.push({ text: "", size: BODY, leading: 6, font: "F1", color: COLOR.text, spaceBefore: 0 });

  while (i < raw.length) {
    const line = raw[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      i += 1;
      const code = [];
      while (i < raw.length && !raw[i].startsWith("```")) {
        code.push(sanitize(raw[i].replace(/\s+$/, "")));
        i += 1;
      }
      i += 1;
      for (const codeLine of code) {
        const parts = codeLine === "" ? [""] : wrapHard(codeLine, COLS - 2);
        for (const part of parts) {
          lines.push(textLine("  " + part, { size: 8, color: COLOR.code, leading: 10 }));
        }
      }
      spacer();
      continue;
    }

    if (line.startsWith("# ")) {
      const text = inline(line.slice(2));
      for (const part of wrap(text, colsFor(15))) {
        lines.push(textLine(part, { size: 15, font: "F2", color: COLOR.accent, spaceBefore: firstBlock ? 0 : 18 }));
      }
      firstBlock = false;
      i += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      const text = inline(line.slice(3));
      for (const part of wrap(text, colsFor(11))) {
        lines.push(textLine(part, { size: 11, font: "F2", color: COLOR.accent, spaceBefore: 15 }));
      }
      i += 1;
      continue;
    }

    if (line.startsWith("### ")) {
      const text = inline(line.slice(4));
      for (const part of wrap(text, colsFor(9.5))) {
        lines.push(textLine(part, { size: 9.5, font: "F2", color: COLOR.text, spaceBefore: 11 }));
      }
      i += 1;
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) {
      lines.push(textLine("-".repeat(COLS), { color: COLOR.muted, size: 8 }));
      spacer();
      i += 1;
      continue;
    }

    if (line.startsWith("|")) {
      const rows = [];
      while (i < raw.length && raw[i].startsWith("|")) {
        const cells = raw[i]
          .split("|")
          .slice(1, -1)
          .map((cell) => inline(cell.trim()));
        const isSeparator = cells.every((cell) => /^:?-{2,}:?$/.test(cell));
        if (!isSeparator) rows.push(cells);
        i += 1;
      }
      lines.push(...renderTable(rows));
      spacer();
      continue;
    }

    const bullet = line.match(/^(\s*)[-*] (.*)$/);
    if (bullet) {
      const indent = Math.min(6, bullet[1].length);
      const text = inline(bullet[2]);
      const parts = wrap(text, COLS - 2 - indent);
      parts.forEach((part, index) => {
        lines.push(
          textLine((index === 0 ? " ".repeat(indent) + "- " : " ".repeat(indent + 2)) + part, { spaceBefore: index === 0 ? 2 : 0 })
        );
      });
      i += 1;
      continue;
    }

    const numbered = line.match(/^(\s*)(\d+)\. (.*)$/);
    if (numbered) {
      const indent = Math.min(6, numbered[1].length);
      const prefix = numbered[2] + ". ";
      const text = inline(numbered[3]);
      const parts = wrap(text, COLS - 2 - indent - prefix.length);
      parts.forEach((part, index) => {
        lines.push(
          textLine(
            (index === 0 ? " ".repeat(indent) + prefix : " ".repeat(indent + prefix.length)) + part,
            { spaceBefore: index === 0 ? 2 : 0 }
          )
        );
      });
      i += 1;
      continue;
    }

    if (line.startsWith("> ")) {
      const text = inline(line.slice(2));
      for (const part of wrap(text, COLS - 2)) {
        lines.push(textLine("| " + part, { color: COLOR.muted }));
      }
      spacer();
      i += 1;
      continue;
    }

    const parts = wrap(inline(line), COLS);
    for (const part of parts) lines.push(textLine(part));
    spacer();
    i += 1;
  }

  return lines;
}

function wrapHard(text, cols) {
  const out = [];
  let rest = text;
  while (rest.length > cols) {
    out.push(rest.slice(0, cols));
    rest = rest.slice(cols);
  }
  out.push(rest);
  return out;
}

function renderTable(rows) {
  if (rows.length === 0) return [];
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = new Array(columnCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < columnCount; c += 1) {
      widths[c] = Math.max(widths[c], (row[c] ?? "").length);
    }
  }
  const gap = 2;
  const total = () => widths.reduce((sum, width) => sum + width, 0) + gap * (columnCount - 1);
  while (total() > COLS) {
    let widest = 0;
    for (let c = 1; c < columnCount; c += 1) if (widths[c] > widths[widest]) widest = c;
    if (widths[widest] <= 10) break;
    widths[widest] -= 1;
  }
  for (let c = 0; c < columnCount; c += 1) widths[c] = Math.max(widths[c], 6);

  const out = [];
  rows.forEach((row, rowIndex) => {
    const cellLines = [];
    for (let c = 0; c < columnCount; c += 1) {
      cellLines.push(wrap(row[c] ?? "", widths[c]));
    }
    const height = Math.max(...cellLines.map((cell) => cell.length));
    for (let l = 0; l < height; l += 1) {
      const cells = [];
      for (let c = 0; c < columnCount; c += 1) {
        const text = cellLines[c][l] ?? "";
        cells.push(text.padEnd(widths[c], " "));
      }
      out.push(
        textLine(cells.join(" ".repeat(gap)).replace(/\s+$/, ""), {
          font: rowIndex === 0 ? "F2" : "F1",
          size: 8,
          leading: 10,
          spaceBefore: rowIndex === 0 ? 4 : 0
        })
      );
    }
    if (rowIndex === 0) {
      const width = total();
      out.push(textLine("-".repeat(Math.min(width, COLS)), { color: COLOR.muted, size: 8, leading: 10 }));
    }
  });
  return out;
}

function paginate(lines, engineVersion) {
  const pages = [];
  let current = [];
  let y = PAGE_H - MARGIN;
  const floor = MARGIN + 22;

  for (const line of lines) {
    const needed = line.spaceBefore + line.leading;
    if (y - needed < floor) {
      pages.push(current);
      current = [];
      y = PAGE_H - MARGIN;
    }
    y -= line.spaceBefore;
    line.y = y;
    y -= line.leading;
    current.push(line);
  }
  pages.push(current);

  const footerLeft = sanitize(`Warden32 User Guide - engine ${engineVersion}`);
  pages.forEach((page, index) => {
    page.push(textLine("", { size: 7.5, leading: 0 }));
    const left = textLine(footerLeft, { size: 7.5, color: COLOR.muted, leading: 0 });
    left.y = FOOT_Y;
    const pageText = `page ${index + 1} / ${pages.length}`;
    const right = textLine(pageText, { size: 7.5, color: COLOR.muted, leading: 0 });
    right.y = FOOT_Y;
    right.x = PAGE_W - MARGIN - pageText.length * 7.5 * 0.6;
    page[page.length - 1] = left;
    page.push(right);
  });

  return pages;
}

function escapeText(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function contentStream(page) {
  const chunks = [];
  for (const line of page) {
    if (line.text === "") continue;
    const x = line.x ?? MARGIN;
    const color = line.color ?? COLOR.text;
    chunks.push(
      `BT /${line.font} ${line.size} Tf ${color[0]} ${color[1]} ${color[2]} rg ` +
        `1 0 0 1 ${x.toFixed(2)} ${line.y.toFixed(2)} Tm (${escapeText(line.text)}) Tj ET`
    );
  }
  return chunks.join("\n");
}

function buildPdf(pageStreams, engineVersion) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("");
  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>");

  const pageIds = [];
  for (const stream of pageStreams) {
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += String(offsets[index]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

function engineVersion() {
  try {
    const source = readFileSync(resolve(root, "src/storage/project.ts"), "utf8");
    const match = source.match(/ENGINE_VERSION = "([^"]+)"/);
    if (match) return match[1];
  } catch {
    /* fall through */
  }
  return "unknown";
}

const markdown = readFileSync(source, "utf8");
const version = engineVersion();
const lines = buildLines(markdown);
const pages = paginate(lines, version);
const streams = pages.map((page) => contentStream(page));
const pdf = buildPdf(streams, version);
writeFileSync(target, pdf);

console.log(`wrote ${target}`);
console.log(`pages: ${pages.length} · text lines: ${lines.length} · bytes: ${pdf.length}`);
