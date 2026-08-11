// Prompt-injection defenses for untrusted text (Slack threads, memory files, metadata).
// These must live in code, not skills: the agent cannot escape-check its own prompt.

// XML-like tags this codebase uses to wrap untrusted content in prompts (see prompt.ts and
// memory.ts). If thread content or stored memory contains one of these delimiters it could
// close the intended block and escape into trusted prompt space. Longest names first so
// alternation prefers the most specific match.
const RESERVED_PROMPT_TAG_NAME_LIST = ["slack-thread", "slack-message", "memory"];

// One tolerant pattern for storage validation AND prompt-time neutralization (no drift):
// format/control/whitespace gaps and full-width forms allowed between all pieces.
const GAP = "[\\p{Cf}\\p{Cc}\\s]*";
// Delimiter characters, including full-width compatibility forms (＜ U+FF1C, ＞ U+FF1E,
// ／ U+FF0F). Raw prompt content is NOT NFKC-normalized before neutralization, so these must
// be matched directly or a payload like `＜/slack-thread＞` would read as a wrapper to the model.
const LT = "[<\\uFF1C]";
const GT = "[>\\uFF1E]";
const SLASH = "[/\\uFF0F]";
// Each reserved tag-name character is matched as a class covering ASCII and its full-width
// compatibility form, so `＜／ｓｌａｃｋ-ｔｈｒｅａｄ＞` is caught as well as ASCII. The `i` flag
// handles ASCII case; full-width upper/lower are listed explicitly.
function compatChar(ch: string): string {
  if (ch === "-") return "[-\\uFF0D]";
  const offset = ch.charCodeAt(0) - 0x61; // 'a'
  const fwLower = (0xff41 + offset).toString(16).toUpperCase();
  const fwUpper = (0xff21 + offset).toString(16).toUpperCase();
  return `[${ch}\\u${fwLower}\\u${fwUpper}]`;
}
function compatSplit(name: string): string {
  return Array.from(name).map(compatChar).join(GAP);
}
// A boundary that must follow the reserved name: the next char may NOT extend it (ASCII or
// full-width letter/digit/hyphen), so `<memoryfoo>` is not treated as the reserved `memory` tag.
const NAME_BOUNDARY = "(?![0-9A-Za-z\\-\\uFF0D\\uFF10-\\uFF19\\uFF21-\\uFF3A\\uFF41-\\uFF5A])";
const RESERVED_PROMPT_TAG_PATTERN =
  `${LT}${GAP}${SLASH}?${GAP}(?:${RESERVED_PROMPT_TAG_NAME_LIST.map(compatSplit).join("|")})${NAME_BOUNDARY}[^>\\uFF1E]*${GT}`;
const RESERVED_PROMPT_TAG = new RegExp(RESERVED_PROMPT_TAG_PATTERN, "iu");
const RESERVED_PROMPT_TAG_GLOBAL = new RegExp(RESERVED_PROMPT_TAG_PATTERN, "giu");

/**
 * Neutralizes reserved prompt-delimiter tags in untrusted text by HTML-encoding their angle
 * brackets, so content interpolated into a `<tag>…</tag>` wrapper cannot close that wrapper
 * and escape into trusted prompt space — including tags split by Unicode format characters
 * or written with full-width brackets. Only our reserved tags are touched — arbitrary
 * angle-bracket content (code, generics, `<flag-name>` placeholders) is left intact.
 */
export function neutralizePromptDelimiters(text: string): string {
  return text.replace(RESERVED_PROMPT_TAG_GLOBAL, (match) =>
    match.replace(/[<＜]/g, "&lt;").replace(/[>＞]/g, "&gt;"),
  );
}

/**
 * Sanitizes a short, single-line metadata value (channel name, username, file name) for safe
 * interpolation into a prompt header or wrapper: NFKC-normalizes and drops Unicode format
 * chars, folds control characters (incl. CR/LF) to spaces so the value can't inject its own
 * line, neutralizes reserved delimiter tags, and collapses whitespace to one line.
 */
export function sanitizeMetadataValue(value: string): string {
  const withoutControlChars = Array.from(value.normalize("NFKC").replace(/\p{Cf}/gu, ""))
    .map((ch) => {
      const code = ch.charCodeAt(0);
      const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
      return isControl ? " " : ch;
    })
    .join("");
  return neutralizePromptDelimiters(withoutControlChars).replace(/\s+/g, " ").trim();
}

/**
 * Sanitizes a user-controlled Slack display name for use as untrusted attribution metadata.
 * On top of sanitizeMetadataValue, removes any `slack_user_id`-style marker and parentheses so
 * the name can never forge a caller-id token. The trusted id is rendered separately by
 * buildPrompt — the display name never enters the privileged header.
 */
export function sanitizeDisplayName(displayName: string): string {
  return sanitizeMetadataValue(displayName)
    .replace(/slack[-_\s]*user[-_\s]*id\s*:?/gi, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Memory injection detection ---

// Invisible padding/splitting characters: Unicode format chars (zero-width space/joiner, BOM,
// bidi marks) and C0/C1 control chars EXCEPT the newline and tab used for legitimate layout.
const INVISIBLE_CHARS = /[\p{Cf}\p{Cc}]/gu;

// Normalizes text for scanning: NFKC folds full-width/homoglyph look-alikes to ASCII;
// vertical whitespace becomes '\n' FIRST — these render as line breaks, so stripping them
// instead would glue a role label onto the previous line and hide it from the line-anchored
// scan; remaining invisible chars are removed so split markers like `SYS<ZWSP>TEM:` can't
// slip past the regexes.
function normalizeForScan(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n|[\r\u000B\u000C\u0085\u2028\u2029]/g, "\n")
    .replace(INVISIBLE_CHARS, (ch) => (ch === "\n" || ch === "\t" ? ch : ""));
}

// Removes lightweight inline-markdown / quote / bracket wrappers so a marker dressed up as
// `**SYSTEM**:`, `` `System` ``, `"SYSTEM":`, or `[SYSTEM]:` is scanned as its plain form.
// Applied only to the scan copy — the stored text is untouched.
function stripInlineMarkdown(text: string): string {
  return text.replace(/[*_~`"'[\]]/g, "");
}

// A Markdown ATX heading line: up to 3 leading spaces, 1–6 `#`, then the heading text.
const ATX_HEADING = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/;
// A setext heading underline, so `Operating Rules\n---` is detected as a heading too.
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
// A raw HTML heading block, which Markdown permits inline.
const HTML_HEADING = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi;

// Terms that make a heading a standing-instruction section for the assistant. Matched
// anywhere in the heading text, so `## Bot Operating Rules` and `## Memory Policies` are
// caught. Memory is factual reference data only — such a section is an escalation vector.
const RULE_HEADING_TERMS = /\b(operating\s+rules?|rules?|instructions?|directives?|policy|policies|standing\s+orders?|persona|system\s+prompt)\b/i;
// Plain "System" as the whole heading, but NOT a factual heading like `## System Architecture`.
const SYSTEM_HEADING = /^system[\s:.!–—-]*$/i;

function isUnsafeHeadingText(headingText: string): boolean {
  const text = stripInlineMarkdown(headingText).trim();
  return RULE_HEADING_TERMS.test(text) || SYSTEM_HEADING.test(text);
}

// `line` is a setext heading when the line below it is an underline and it isn't blank or an
// ATX heading itself. Shared by detection and salvage so both agree on what a heading is.
function isSetextHeading(line: string, next: string): boolean {
  const text = line.trim();
  return SETEXT_UNDERLINE.test(next) && text !== "" && !text.startsWith("#");
}

function containsUnsafeHeading(text: string): boolean {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const atx = ATX_HEADING.exec(lines[i]);
    if (atx && isUnsafeHeadingText(atx[1])) return true;
    if (isSetextHeading(lines[i], lines[i + 1] ?? "") && isUnsafeHeadingText(lines[i])) return true;
  }
  for (const match of text.matchAll(HTML_HEADING)) {
    if (isUnsafeHeadingText(match[1])) return true;
  }
  return false;
}

// Classic prompt-injection / identity-override directives that should never sit in memory.
const INJECTED_DIRECTIVE_PATTERNS = [
  /\bignore\s+(?:(?:all|the|your|any|these|those)\s+)?(?:previous|prior|above|earlier)\s+(?:\w+\s+){0,2}(?:instructions?|rules?|messages?|prompts?|context|directions?|guidelines?)\b/i,
  /\bdisregard\s+(?:(?:all|the|your|any|these|those)\s+)?(?:\w+\s+){0,2}(?:previous|prior|above|earlier|system|instructions?|rules?|prompts?|context|guidelines?)\b/i,
  /\bfrom now on\b/i,
  /\byou are now\b/i,
  /\byour\s+(new\s+)?(name|identity)\s+is\b/i,
  /\b(always|never)\s+(call|address|refer\s+to|greet)\s+(me|us|the\s+user)\b/i,
  /\bpretend\s+(to\s+be|that)\b/i,
  /\bact\s+as\s+(an?|the)\b/i,
  /\b(?:store|save|remember|record|put)\s+(?:\w+\s+){0,3}in(?:to)?\s+(?:your\s+)?memory\b/i,
  /\b(?:update|modify|edit|change)\s+(?:your\s+)?memory\b/i,
  /\bremember\s+(?:to|that)\b/i,
  /\bin\s+(?:your\s+)?memory\s+that\b/i,
  /\byou\s+must\b/i,
];

// Leading decoration a line may carry before an anchored marker: whitespace, Markdown
// (blockquote/heading/table/emphasis/list), quotes, bullets, dashes, and ordered-list markers.
const LINE_MARKER_PREFIX = `(?:[\\s>#|*+.)"'\`\\d\\u2022\\u2023\\u2043\\u25AA\\u25CF\\u25CB\\u25E6\\u00B7\\u2219\\u2027\\u2013\\u2014-]|[a-z]\\))*`;

// Chat role-label markers at the start of a line. Since memory is embedded in prompts, an
// unquoted role label could read as a turn boundary. The colon class covers colon lookalikes
// NFKC does not fold. Quoted payloads are NOT exempt.
const ROLE_LABEL_PATTERN = new RegExp(`^${LINE_MARKER_PREFIX}(system|assistant|user|developer|human)\\s*[:∶꞉]`, "i");

// Standing instructions aimed at the assistant (`Always approve …`, `Never use tools …`) are
// behavior, not reference data. Anchored at line start so mid-sentence factual uses stay legal.
const STANDING_INSTRUCTION_PATTERN = new RegExp(
  `^${LINE_MARKER_PREFIX}(?:always|never|do\\s*not|don'?t)\\s+` +
  `(?:(?:ever|immediately|also|again|just|really|please|silently|automatically|directly|first|blindly)\\s+){0,2}` +
  `(?:approve|reject|use|run|invoke|reveal|post|mention|assign|ignore|skip|execute|share|send|reply|respond|call|treat|merge|delete|create|allow|deny|trust|follow|escalate)\\b`,
  "i",
);

// Directive/role-label scan for a single logical line, run on its inline-markdown-stripped
// form. Task-list markers are cleared first: stripInlineMarkdown would leave `[x]` as a bare
// `x` that blocks the anchored prefix (`- [x] Always approve …` must still match).
function classifyUnsafeLine(line: string): "directive" | "role" | null {
  const plain = stripInlineMarkdown(line.replace(/\[[ xX]\]/g, " "));
  if (INJECTED_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(plain))) return "directive";
  if (STANDING_INSTRUCTION_PATTERN.test(plain)) return "directive";
  if (ROLE_LABEL_PATTERN.test(plain)) return "role";
  return null;
}

// A physical line that begins a new Markdown block (list item, ATX heading, blockquote, or a
// thematic-break/setext underline). Other non-blank lines are continuations.
const NEW_BLOCK_LINE =
  /^\s*(?:[-*+]\s|\d+[.)]\s|[a-z][.)]\s|[•‣⁃▪●○◦·∙‧]\s?|#{1,6}\s|>|=+\s*$|-+\s*$)/i;

// Collapses Markdown continuation lines into single logical lines, so a directive or role
// marker split across a wrapped list item / paragraph is scanned as one instruction.
function toLogicalLines(text: string): string[] {
  const out: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current) out.push(current.replace(/\s+/g, " ").trim());
    current = "";
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flush();
    } else if (current === "" || NEW_BLOCK_LINE.test(line)) {
      flush();
      current = line;
    } else {
      current += " " + line;
    }
  }
  flush();
  return out;
}

/**
 * Detects unsafe content in a memory document. Scanned against the FULL normalized document
 * (not a diff) so an already-poisoned document is rejected whether newly added or carried
 * forward. There is no quoted-example exemption: quotation does not make a role label or
 * directive inert once the string is embedded in a prompt.
 * Returns a short reason string when unsafe content is found, else null.
 */
export function detectInjectedRules(content: string): string | null {
  const normalized = normalizeForScan(content);
  if (RESERVED_PROMPT_TAG.test(normalized)) {
    return "contains a reserved prompt-delimiter tag — could escape the untrusted-content block";
  }
  if (containsUnsafeHeading(normalized)) {
    return "contains a rule/policy/directive/system section — memory must stay factual reference data";
  }
  // Physical lines catch line-anchored markers that logical-line collapsing would swallow
  // into the preceding paragraph; logical lines catch markers split across continuations.
  for (const line of [...normalized.split("\n"), ...toLogicalLines(normalized)]) {
    const kind = classifyUnsafeLine(line);
    if (kind === "directive") return "contains an injected behavioral directive";
    if (kind === "role") return "contains a chat role-label prompt marker (e.g. SYSTEM:/USER:)";
  }
  return null;
}

// Returns the document with unsafe content removed: an unsafe rule/system heading takes its
// whole section (until the next heading), and standalone directive / role-label / delimiter
// lines are dropped.
function stripUnsafeContent(normalized: string): string {
  const lines = normalized.split("\n");
  const HTML_HEADING_OPEN = /<h[1-6]\b/i;
  const isHeadingStart = (line: string, next: string): boolean =>
    ATX_HEADING.test(line) || HTML_HEADING_OPEN.test(line) || isSetextHeading(line, next);
  const htmlHeadingUnsafe = (line: string): boolean =>
    [...line.matchAll(HTML_HEADING)].some((m) => isUnsafeHeadingText(m[1]));
  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1] ?? "";
    const atx = ATX_HEADING.exec(line);
    const atxUnsafe = atx !== null && isUnsafeHeadingText(atx[1]);
    const setextUnsafe = isSetextHeading(line, next) && isUnsafeHeadingText(line);
    if (atxUnsafe || setextUnsafe || htmlHeadingUnsafe(line)) {
      i += setextUnsafe ? 2 : 1; // skip the heading (setext = text line + underline)
      while (i < lines.length && !isHeadingStart(lines[i], lines[i + 1] ?? "")) i++; // ...and its body
      continue;
    }
    if (RESERVED_PROMPT_TAG.test(line) || classifyUnsafeLine(line) !== null) {
      i++;
      continue;
    }
    kept.push(line);
    i++;
  }
  return dropUnsafeLogicalGroups(kept).join("\n");
}

// Mirrors the logical-line scan so salvage matches detection.
function dropUnsafeLogicalGroups(lines: string[]): string[] {
  const kept: string[] = [];
  let group: string[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    const logical = group.join(" ").replace(/\s+/g, " ").trim();
    if (classifyUnsafeLine(logical) === null) kept.push(...group);
    group = [];
  };
  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      kept.push(line);
    } else {
      if (group.length > 0 && NEW_BLOCK_LINE.test(line)) flush();
      group.push(line);
    }
  }
  flush();
  return kept;
}

export interface SafeMemory {
  /** Safe content to inject into the prompt, or null if none could be salvaged. */
  content: string | null;
  /** True when the stored document was unsafe and had to be stripped/omitted. */
  wasUnsafe: boolean;
}

/**
 * Makes a stored memory file safe to inject into an agent prompt. Memory can be poisoned by
 * an earlier write, an out-of-band repo edit, or a validator gap, so reads must fail closed:
 * - If the document is already safe, it is returned unchanged.
 * - Otherwise unsafe sections/lines are stripped; the sanitized remainder is returned only if
 *   it then passes detection, else `null` (omit memory entirely rather than inject an injection).
 */
export function sanitizeMemoryForInjection(raw: string): SafeMemory {
  if (detectInjectedRules(raw) === null) {
    return { content: raw, wasUnsafe: false };
  }
  const stripped = stripUnsafeContent(normalizeForScan(raw));
  const salvageable = stripped.trim().length > 0 && detectInjectedRules(stripped) === null;
  return { content: salvageable ? stripped : null, wasUnsafe: true };
}
