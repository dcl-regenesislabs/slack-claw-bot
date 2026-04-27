export interface CsvRow {
  [column: string]: string;
}

export interface CsvParseResult {
  headers: string[];
  rows: CsvRow[];
}

export function parseCsv(text: string): CsvParseResult {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  // Google Forms exports in some locales (e.g. EU) use ';' as the field separator.
  // Auto-detect by counting unquoted commas vs semicolons on the header line.
  const delimiter = detectDelimiter(text);

  const cells: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      cells.push(row);
      row = [];
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (inQuotes) {
    throw new Error("Unterminated quoted field in CSV (file may be truncated)");
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    cells.push(row);
  }

  if (cells.length === 0) return { headers: [], rows: [] };

  // Disambiguate duplicate header names with a "(2)", "(3)" suffix.
  // Google Forms exports the same question label once per conditional branch
  // (e.g. "Project title" appears in both the Content and Tech track blocks);
  // without this, the later column would silently overwrite the earlier one.
  // Some exporters (pandas, Excel) pre-disambiguate duplicates with a ".1",
  // ".2" suffix — strip those so dedupeHeaders can re-emit the canonical "(N)"
  // form and downstream lookups stay schema-stable.
  const rawHeaders = cells[0].map((h) => h.trim().replace(/\.\d+$/, ""));
  const headers = dedupeHeaders(rawHeaders);
  const rows: CsvRow[] = cells
    .slice(1)
    .filter((r) => r.some((cell) => cell.trim() !== ""))
    .map((r) => {
      const obj: CsvRow = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = (r[j] ?? "").trim();
      }
      return obj;
    });

  return { headers, rows };
}

/** Pick ',' or ';' as the field separator based on whichever appears more
 * often outside of quoted regions in the header line. Defaults to ','. */
function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "\n" || ch === "\r") break;
    if (ch === ",") commas++;
    else if (ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h) => {
    const count = seen.get(h) ?? 0;
    seen.set(h, count + 1);
    return count === 0 ? h : `${h} (${count + 1})`;
  });
}

/** Headers that should not appear in the agent-facing or forum-facing rendering.
 * Contains PII (email) and bureaucratic acknowledgments that add noise without
 * evaluation value. Also exported so the deterministic topic template can reuse it. */
export const BUREAUCRACY_HEADERS = new Set<string>([
  "Timestamp",
  "Applying for",
  "I understand that proposals must align with the selected category theme for this season",
  "Email address",
  "I confirm that the information submitted here is accurate to the best of my knowledge",
  "I understand that the program is intended to support open-source work",
  "I understand that DCL Regenesis Labs may contact me for follow-up questions or clarifications during review",
]);

function stripHeaderSuffix(h: string): string {
  return h.replace(/\s*\(\d+\)$/, "");
}

export function formatCsvAsProposal(parsed: CsvParseResult, sourceName: string): string {
  const { headers, rows } = parsed;
  if (rows.length === 0) {
    return `_(CSV \`${sourceName}\` had no data rows)_`;
  }

  const count = rows.length;
  const header =
    `**This CSV (\`${sourceName}\`) contains exactly ${count} proposal${count === 1 ? "" : "s"}. ` +
    `Do not infer, generate, or hallucinate additional proposals.**\n\n---\n\n`;

  const blocks = rows.map((row, idx) => {
    const fields = headers
      .map((h) => {
        const label = stripHeaderSuffix(h);
        if (BUREAUCRACY_HEADERS.has(label)) return null;
        const v = row[h];
        if (!v || v.trim() === "") return null;
        return `- **${label}**: ${v}`;
      })
      .filter((line): line is string => line !== null)
      .join("\n");
    return `## Proposal ${idx + 1} of ${count}\n\n${fields}`;
  });

  return header + blocks.join("\n\n---\n\n");
}
