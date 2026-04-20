import type { CsvRow } from "./csv.js";

/**
 * Deterministic renderer: maps a Google-Form CSV row to a structured
 * Discourse topic. No LLM — the column headers are known and stable across
 * proposals, so we just pick and lay out the fields we care about.
 *
 * Returns null if the row doesn't look like a standard form submission
 * (e.g. missing both project title and funding request). The caller can
 * fall back to the LLM-based distiller in that case.
 */
export function renderProposalTopic(row: CsvRow): { title: string; body: string } | null {
  const projectTitle = pick(row, "Project title", "Project title (2)");
  const funding = pick(row, "What is your estimated funding request in USD?");
  if (!projectTitle && !funding) return null;

  const category = pick(row, "Which category are you applying to?");

  const lines: string[] = [];

  // --- Header card
  const titleForHeader = projectTitle || "Grant Proposal";
  const headerTitle = category ? `${titleForHeader} — ${category}` : titleForHeader;
  lines.push(`# [Grant Proposal] ${headerTitle}`);
  lines.push("");
  lines.push("| | |", "|---|---|");
  if (projectTitle) lines.push(`| **Project** | ${projectTitle} |`);
  if (category) lines.push(`| **Category** | ${category} |`);
  if (funding) lines.push(`| **Funding request** | $${funding} |`);
  lines.push("", "---", "");

  // --- About the applicant
  const applicantType = pick(row, "Who is applying?");
  const name = pick(row, "Full name or studio / company name");
  const forum = pick(row, "Decentraland Forum Username");
  const country = pick(row, "Country or region");
  const website = pick(row, "Website, portfolio, or company page");
  const socials = pick(row, "X, LinkedIn, GitHub, or other relevant profile");

  if (applicantType || name || forum || country || website || socials) {
    lines.push("## About the applicant", "", "| | |", "|---|---|");
    if (applicantType) lines.push(`| **Applicant** | ${applicantType} |`);
    if (name) lines.push(`| **Name** | ${name} |`);
    if (forum) lines.push(`| **Forum** | ${formatForumLink(forum)} |`);
    if (country) lines.push(`| **Country** | ${country} |`);
    if (website) lines.push(`| **Website** | ${formatLink(website)} |`);
    if (socials) lines.push(`| **Socials** | ${formatLinksInline(socials)} |`);
    lines.push("", "---", "");
  }

  // --- The team
  const teamDesc = pick(row, "Tell us about the team behind this proposal");
  const teamSize = pick(row, "How many people would actively work on this project?");
  const skills = pick(row, "What relevant skills or expertise does your team bring?");
  if (teamDesc || teamSize || skills) {
    lines.push("## The team", "");
    if (teamSize) lines.push(`**Team size:** ${teamSize}`, "");
    if (teamDesc) lines.push(teamDesc, "");
    if (skills) lines.push("**Skills & expertise:**", "", skills, "");
    lines.push("---", "");
  }

  // --- DCL experience
  const dclRel = pick(row, "What best describes your current relationship with Decentraland?");
  const shipped = pick(row, "Have you or your team previously shipped anything in Decentraland?");
  const dclWork = pick(row, "If yes, tell us what you built in Decentraland");
  const whyDcl = pick(row, "Why do you want to build this for Decentraland?");
  const similar = pick(row, "What similar projects have you or your team built before?");
  const pastLinks = pick(row, "Links to relevant past work");
  const confidence = pick(row, "How confident are you that your team can deliver this project within 90 days?");
  if (dclRel || shipped || whyDcl || similar || pastLinks || confidence) {
    lines.push("## DCL experience", "");
    if (dclRel) lines.push(`**Relationship with Decentraland:** ${dclRel}`, "");
    if (shipped && !isNegative(shipped) && dclWork) {
      lines.push(`**Prior Decentraland work:**`, "", dclWork, "");
    }
    if (whyDcl) lines.push(`**Why build for Decentraland?**`, "", whyDcl, "");
    if (similar) lines.push(`**Prior similar work:**`, "", similar, "");
    if (pastLinks) lines.push(`**Links:** ${formatLinksInline(pastLinks)}`, "");
    if (confidence) lines.push(`**Confidence in 90-day delivery:** ${confidence}`, "");
    lines.push("---", "");
  }

  // --- The project (track-aware)
  const whatIs = pick(row, "What is the project?", "What is the project? (2)");
  const themeAlign = pick(
    row,
    "How does this proposal align with the AI-assisted tooling theme?",
    "How does this proposal embody the Mobile-first experiences theme?",
  );
  const userActions = pick(row, "What will users actually do in the experience?");
  const audience = pick(row, "Who would use this tool or system?", "Who is this experience for?");
  const improvement = pick(row, "Why would this improve Decentraland?");
  const problem = pick(row, "What problem does this solve?");
  const basedOn = pick(row, "If this is based on an existing experience, share the link");

  if (whatIs || themeAlign || userActions || audience || improvement || problem || basedOn) {
    lines.push("## The project", "");
    if (whatIs) {
      lines.push(`### What is ${projectTitle || "the project"}?`, "", whatIs, "");
    }
    if (themeAlign) {
      lines.push(`### ${themeAlignHeading(category)}`, "", themeAlign, "");
    }
    if (userActions) lines.push(`### What will users do?`, "", userActions, "");
    if (audience) lines.push(`### Who is this for?`, "", audience, "");
    if (improvement) lines.push(`### Why would this improve Decentraland?`, "", improvement, "");
    if (problem) lines.push(`### What problem does this solve?`, "", problem, "");
    if (basedOn) lines.push(`**Based on an existing experience:** ${formatLink(basedOn)}`, "");
    lines.push("---", "");
  }

  // --- Deliverables
  const deliverables = pick(row, "What would be delivered within 90 days?", "What would be delivered within 90 days? (2)");
  const openSource = pick(row, "How would this be shared as open-source work?");
  const successMetrics = pick(row, "How would you measure success?", "How would you measure success? (2)");
  if (deliverables || openSource || successMetrics) {
    lines.push("## Deliverables (90 days)", "");
    if (deliverables) lines.push(deliverables, "");
    if (openSource) lines.push("### Open source", "", openSource, "");
    if (successMetrics) lines.push("### Success metrics", "", successMetrics, "");
    lines.push("---", "");
  }

  // --- Budget
  const budgetRationale = pick(row, "How did you estimate this budget?");
  const otherFunding = pick(row, "Is this project also receiving funding from another source?");
  const otherFundingDetails = pick(row, "If yes, please explain");
  if (funding || budgetRationale) {
    lines.push(funding ? `## Budget — $${funding}` : "## Budget", "");
    if (budgetRationale) lines.push(budgetRationale, "");
    const otherLine = otherFunding && !isNegative(otherFunding)
      ? otherFundingDetails || otherFunding
      : "None";
    lines.push(`**Other funding sources:** ${otherLine}`, "");
    lines.push("---", "");
  }

  // --- Milestones
  const milestones = pick(row, "What are the main milestones you expect across the 90-day period?");
  if (milestones) {
    lines.push("## Milestones", "", milestones, "", "---", "");
  }

  // --- Links
  const visual = pick(row, "Upload or link a visual project overview");
  const repo = pick(row, "Repository, prototype, or technical documentation");
  if (visual || repo) {
    lines.push("## Links", "", "| Resource | Link |", "|---|---|");
    if (visual) lines.push(`| Visual overview | ${formatLinksInline(visual)} |`);
    if (repo) lines.push(`| Technical documentation | ${formatLinksInline(repo)} |`);
    lines.push("", "---", "");
  }

  // --- Notes (blockquote)
  const notes = pick(row, "Is there anything else you would like us to know?");
  if (notes) {
    const quoted = notes.split("\n").map((l) => `> *${l}*`).join("\n");
    lines.push(quoted, "");
  }

  return {
    title: headerTitle,
    body: lines.join("\n").trimEnd(),
  };
}

function pick(row: CsvRow, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

function isNegative(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "no" || s === "none" || s === "n/a";
}

function themeAlignHeading(category: string): string {
  const lc = category.toLowerCase();
  if (lc.includes("ai")) return "How does this align with the AI-assisted tooling theme?";
  if (lc.includes("mobile")) return "How does this embody the Mobile-first experiences theme?";
  return "How does this align with the theme?";
}

function formatForumLink(v: string): string {
  const m = v.match(/\/u\/([^/?#\s]+)/);
  if (m) {
    const url = v.startsWith("http") ? v : `https://forum.decentraland.org/u/${m[1]}`;
    return `[@${m[1]}](${url})`;
  }
  return v;
}

function formatLink(v: string): string {
  if (/^https?:\/\//i.test(v)) {
    const clean = v.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `[${clean}](${v})`;
  }
  if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v)) {
    return `[${v}](https://${v})`;
  }
  return v;
}

/** Render one or more URLs found in a prose blob as inline markdown links,
 * separated by " · ". Non-URL text is returned as-is. */
function formatLinksInline(v: string): string {
  const urls = v.match(/https?:\/\/\S+[^\s,.;:)]/gi);
  if (!urls || urls.length === 0) return formatLink(v);
  return urls
    .map((u) => {
      const clean = u.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      return `[${clean}](${u})`;
    })
    .join(" · ");
}
