export interface CsvRow {
  [column: string]: string;
}

export interface CsvParseResult {
  headers: string[];
  rows: CsvRow[];
}

export function parseCsv(text: string): CsvParseResult {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

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
    if (ch === ",") {
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

  if (field !== "" || row.length > 0) {
    row.push(field);
    cells.push(row);
  }

  if (cells.length === 0) return { headers: [], rows: [] };

  const headers = cells[0].map((h) => h.trim());
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
        const v = row[h];
        if (!v || v.trim() === "") return null;
        return `- **${h}**: ${v}`;
      })
      .filter((line): line is string => line !== null)
      .join("\n");
    return `## Proposal ${idx + 1} of ${count}\n\n${fields}`;
  });

  return header + blocks.join("\n\n---\n\n");
}
