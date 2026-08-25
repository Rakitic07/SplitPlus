// Client-side export helpers — no server round-trips and, deliberately, no
// heavy/vulnerable third-party document libraries. Excel files are real .xlsx
// packages (a zip of SpreadsheetML) built with the tiny, dependency-free
// `fflate`; PDFs are produced from a themed HTML view via the browser's native
// "Save as PDF" print pipeline. Everything interpolated from user data is HTML/
// XML-escaped to keep the generated documents injection-safe.
import { zipSync, strToU8 } from "fflate";

export type XlsxCell = string | number;
export type XlsxSheet = { name: string; header: string[]; rows: XlsxCell[][] };

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Strip control chars that are illegal in XML 1.0.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

export function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function colLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// Excel worksheet names can't exceed 31 chars or contain : \ / ? * [ ].
function safeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || fallback).slice(0, 31);
}

function sheetXml(sheet: XlsxSheet): string {
  const allRows = [sheet.header, ...sheet.rows];
  const body = allRows
    .map((row, ri) => {
      const r = ri + 1;
      const cells = row
        .map((v, ci) => {
          const ref = `${colLetter(ci)}${r}`;
          if (typeof v === "number" && Number.isFinite(v)) {
            return `<c r="${ref}"><v>${v}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(
            String(v ?? "")
          )}</t></is></c>`;
        })
        .join("");
      return `<row r="${r}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

// Assemble a minimal but valid .xlsx (Office Open XML) workbook.
export function makeXlsx(sheets: XlsxSheet[]): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s, i) => {
    let name = safeSheetName(s.name, `Sheet${i + 1}`);
    let dedup = name;
    let k = 2;
    while (used.has(dedup.toLowerCase())) dedup = `${name.slice(0, 28)} ${k++}`;
    used.add(dedup.toLowerCase());
    return dedup;
  });

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
    .map(
      (_s, i) =>
        `<Override PartName="/xl/worksheets/sheet${
          i + 1
        }.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("")}</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
    .map(
      (name, i) =>
        `<sheet name="${escXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join("")}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_s, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
          i + 1
        }.xml"/>`
    )
    .join("")}</Relationships>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });

  return zipSync(files, { level: 6 });
}

// Trigger a browser download for arbitrary binary/text content.
export function downloadBlob(data: BlobPart, filename: string, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadXlsx(sheets: XlsxSheet[], filename: string) {
  const bytes = makeXlsx(sheets);
  // `bytes` is a Uint8Array — a valid BlobPart at runtime. The cast sidesteps
  // the ArrayBuffer/SharedArrayBuffer variance friction in the DOM lib types.
  downloadBlob(
    bytes as unknown as BlobPart,
    filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

// Render a themed HTML document into an off-screen iframe and invoke the print
// dialog so the user can save it as a PDF. Using an iframe (instead of
// window.open) sidesteps popup blockers.
export function printDocument(html: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    opacity: "0",
  });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const win = iframe.contentWindow;
  const go = () => {
    win?.focus();
    win?.print();
    setTimeout(() => iframe.remove(), 1000);
  };
  // Give the iframe a tick to lay out fonts/styles before printing.
  if (doc.readyState === "complete") setTimeout(go, 250);
  else iframe.onload = () => setTimeout(go, 250);
}

export type PdfTable = { columns: string[]; rows: string[][] };

// Build a branded, print-ready HTML report. All dynamic strings are pre-escaped
// by the caller-facing helper below.
export function buildReportHtml(opts: {
  title: string;
  subtitle: string;
  summary: { label: string; value: string }[];
  tables: { heading: string; table: PdfTable }[];
}): string {
  const summary = opts.summary
    .map(
      (s) =>
        `<div class="stat"><div class="stat-l">${escHtml(
          s.label
        )}</div><div class="stat-v">${escHtml(s.value)}</div></div>`
    )
    .join("");

  const tables = opts.tables
    .map((t) => {
      const head = t.table.columns
        .map((c) => `<th>${escHtml(c)}</th>`)
        .join("");
      const body = t.table.rows
        .map(
          (r) =>
            `<tr>${r.map((cell) => `<td>${escHtml(cell)}</td>`).join("")}</tr>`
        )
        .join("");
      return `<h2>${escHtml(t.heading)}</h2><table><thead><tr>${head}</tr></thead><tbody>${
        body || `<tr><td class="empty" colspan="${t.table.columns.length}">No expenses in this period.</td></tr>`
      }</tbody></table>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escHtml(
    opts.title
  )}</title><style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1c1917; margin: 32px; }
    .brand { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
    .dot { width:14px; height:14px; border-radius:5px; background:linear-gradient(135deg,#fb923c,#f59e0b); }
    .brand b { font-size:15px; letter-spacing:.2px; background:linear-gradient(135deg,#f97316,#f59e0b); -webkit-background-clip:text; background-clip:text; color:transparent; }
    h1 { font-size: 22px; margin: 8px 0 2px; }
    .sub { color:#78716c; font-size:12px; margin-bottom:18px; }
    .stats { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:22px; }
    .stat { border:1px solid #eee7e1; border-radius:12px; padding:10px 14px; min-width:120px; background:#fdfbf9; }
    .stat-l { font-size:10px; text-transform:uppercase; letter-spacing:.6px; color:#a8a29e; }
    .stat-v { font-size:16px; font-weight:800; margin-top:3px; }
    h2 { font-size:14px; margin:22px 0 8px; }
    table { width:100%; border-collapse:collapse; font-size:11.5px; }
    th { text-align:left; background:#fb923c; color:#fff; padding:7px 9px; font-weight:700; }
    th:last-child, td:last-child { text-align:right; }
    td { padding:6px 9px; border-bottom:1px solid #f0ebe6; }
    tbody tr:nth-child(even) td { background:#faf7f4; }
    td.empty { text-align:center; color:#a8a29e; padding:16px; }
    .foot { margin-top:26px; color:#a8a29e; font-size:10px; text-align:center; }
    @media print { body { margin: 14mm; } th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style></head><body>
    <div class="brand"><span class="dot"></span><b>Split+</b></div>
    <h1>${escHtml(opts.title)}</h1>
    <div class="sub">${escHtml(opts.subtitle)}</div>
    <div class="stats">${summary}</div>
    ${tables}
    <div class="foot">Generated by Split+ · ${escHtml(
      new Date().toLocaleString()
    )}</div>
  </body></html>`;
}
