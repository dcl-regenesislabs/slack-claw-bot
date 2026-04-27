import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.js";
import { renderProposalTopic } from "../src/proposal-template.js";

function buildRow(overrides: Record<string, string>): Record<string, string> {
  return overrides;
}

test("renderProposalTopic: returns null when row has no project title or funding", () => {
  const result = renderProposalTopic({ "Country or region": "Uruguay" });
  assert.equal(result, null);
});

test("renderProposalTopic: tech track — full MD matches reference shape", () => {
  const row = buildRow({
    "Project title": "",
    "Project title (2)": "AI Scene Controller",
    "Which category are you applying to?": "Tech Ecosystem — AI-assisted tooling",
    "What is your estimated funding request in USD?": "15000",
    "Who is applying?": "Studio / Company",
    "Full name or studio / company name": "CoBuilders",
    "Decentraland Forum Username": "https://forum.decentraland.org/u/pollodumas",
    "Country or region": "Uruguay",
    "Website, portfolio, or company page": "cobuilders.xyz",
    "X, LinkedIn, GitHub, or other relevant profile": "http://github.com/CoBuilders-xyz",
    "How many people would actively work on this project?": "3",
    "Tell us about the team behind this proposal": "We are CoBuilders.",
    "What relevant skills or expertise does your team bring?": "Node.js and TypeScript.",
    "What best describes your current relationship with Decentraland?": "External studio",
    "Why do you want to build this for Decentraland?": "Open architecture.",
    "How confident are you that your team can deliver this project within 90 days?": "Very confident",
    "What is the project? (2)": "A self-deployable AI orchestration system.",
    "How does this proposal align with the AI-assisted tooling theme?": "AI is central.",
    "Who would use this tool or system?": "DCL developers.",
    "What problem does this solve?": "Scenes are limited by static logic.",
    "What would be delivered within 90 days? (2)": "- Orchestrator\n- SDK",
    "How would this be shared as open-source work?": "Released on GitHub.",
    "How would you measure success? (2)": "- Deployments\n- Scene count",
    "How did you estimate this budget?": "Engineering time.",
    "What are the main milestones you expect across the 90-day period?": "Phase 1: weeks 1-4",
    "Is this project also receiving funding from another source?": "No",
    "Repository, prototype, or technical documentation": "https://example.com/docs",
  });
  const out = renderProposalTopic(row);
  assert.ok(out);
  // Title is SHORT form: project + top-level track only, no sub-category
  assert.equal(out!.title, "AI Scene Controller — Tech Ecosystem");
  assert.doesNotMatch(out!.title, /AI-assisted/);
  // H1 in body matches the same short form
  assert.match(out!.body, /# \[Grant Proposal\] AI Scene Controller — Tech Ecosystem\n/);
  // Full category still visible inside the header card
  assert.match(out!.body, /\| \*\*Category\*\* \| Tech Ecosystem — AI-assisted tooling \|/);
  assert.match(out!.body, /\| \*\*Funding request\*\* \| \$15000 \|/);
  // Forum username rendered as @handle link
  assert.match(out!.body, /\[@pollodumas\]\(https:\/\/forum\.decentraland\.org\/u\/pollodumas\)/);
  // Theme heading is the AI one, not mobile
  assert.match(out!.body, /AI-assisted tooling theme/);
  assert.doesNotMatch(out!.body, /Mobile-first/);
  // Open source block present
  assert.match(out!.body, /### Open source/);
  assert.match(out!.body, /Released on GitHub/);
  // "Other funding sources" says "None" because the CSV said "No"
  assert.match(out!.body, /\*\*Other funding sources:\*\* None/);
  // Budget heading has amount
  assert.match(out!.body, /## Budget — \$15000/);
});

test("renderProposalTopic: content track — picks mobile theme heading", () => {
  const row = buildRow({
    "Project title": "FlagTag",
    "Which category are you applying to?": "Content — Mobile-first experiences",
    "What is your estimated funding request in USD?": "14000",
    "Full name or studio / company name": "Luke Escobar",
    "What is the project?": "A multiplayer tag game.",
    "How does this proposal embody the Mobile-first experiences theme?": "Built mobile-first.",
    "Who is this experience for?": "DCL players.",
    "What will users actually do in the experience?": "Compete to hold the flag.",
    "Why would this improve Decentraland?": "Persistent multiplayer gameplay.",
    "What would be delivered within 90 days?": "- Mobile UI\n- Scaling tests",
    "How would you measure success?": "- CCU\n- Retention",
  });
  const out = renderProposalTopic(row);
  assert.ok(out);
  assert.match(out!.body, /Mobile-first experiences theme/);
  assert.doesNotMatch(out!.body, /AI-assisted/);
  assert.match(out!.body, /### What will users do\?/);
  assert.match(out!.body, /### Why would this improve Decentraland\?/);
});

test("renderProposalTopic: omits sections when fields are empty", () => {
  const out = renderProposalTopic({
    "Project title": "Bare",
    "What is your estimated funding request in USD?": "1000",
  });
  assert.ok(out);
  assert.doesNotMatch(out!.body, /## About the applicant/);
  assert.doesNotMatch(out!.body, /## The team/);
  assert.doesNotMatch(out!.body, /## DCL experience/);
  assert.doesNotMatch(out!.body, /## Links/);
});

test("renderProposalTopic: short title strips sub-category from track", () => {
  const out = renderProposalTopic({
    "Project title": "MyApp",
    "Which category are you applying to?": "Content — Mobile-first experiences",
    "What is your estimated funding request in USD?": "5000",
  });
  assert.ok(out);
  assert.equal(out!.title, "MyApp — Content");
  assert.match(out!.body, /\| \*\*Category\*\* \| Content — Mobile-first experiences \|/);
});

test("renderProposalTopic: no category collapses to just project title", () => {
  const out = renderProposalTopic({
    "Project title": "Barebones",
    "What is your estimated funding request in USD?": "100",
  });
  assert.ok(out);
  assert.equal(out!.title, "Barebones");
  assert.match(out!.body, /# \[Grant Proposal\] Barebones\n/);
});

test("renderProposalTopic: end-to-end with pandas-style .N duplicates (semicolon delimiter)", () => {
  // New Google Form export shape: semicolon delimiter + ".1" suffix on duplicate
  // headers (instead of literal duplicates). The Tech-track fields land in the
  // ".1" columns, so projectTitle/whatIs/etc. must still resolve.
  const csv =
    `Timestamp;Who is applying?;Full name or studio / company name;Primary contact person;` +
    `Which category are you applying to?;Project title;What is the project?;` +
    `What would be delivered within 90 days?;How would you measure success?;` +
    `What kind of technical proposal are you submitting?;Project title.1;What is the project?.1;` +
    `How does this proposal align with the AI-assisted tooling theme?;Who would use this tool or system?;` +
    `What problem does this solve?;What would be delivered within 90 days?.1;` +
    `How would this be shared as open-source work?;How would you measure success?.1;` +
    `What is your estimated funding request in USD?\n` +
    `01/04/2026;Individual;Mohammed Zaid;Mohammed Zaid;Tech Ecosystem — AI-assisted tooling;;;;;` +
    `A library, integration, or infrastructure component;SITR Protocol;ZK private MANA payments;` +
    `Solves privacy.;DCL devs.;Public on-chain history.;- ZK circuit;Open source MIT.;- 10 mainnet txs;13000`;
  const parsed = parseCsv(csv);
  assert.equal(parsed.rows.length, 1);
  // Confirm the .1 suffix got normalized to canonical (2)
  assert.ok(parsed.headers.includes("Project title (2)"));
  assert.ok(parsed.headers.includes("What is the project? (2)"));

  const out = renderProposalTopic(parsed.rows[0]);
  assert.ok(out);
  assert.equal(out!.title, "SITR Protocol — Tech Ecosystem");
  assert.match(out!.body, /ZK private MANA payments/);
  assert.match(out!.body, /## Budget — \$13000/);
  assert.match(out!.body, /AI-assisted tooling theme/);
  assert.match(out!.body, /- ZK circuit/);
  assert.match(out!.body, /- 10 mainnet txs/);
});

test("renderProposalTopic: end-to-end with the real sample CSV", () => {
  const csv = `Timestamp,Applying for,I understand that proposals must align with the selected category theme for this season,Who is applying?,Full name or studio / company name,Primary contact person,Email address,Decentraland Forum Username,Country or region,"Website, portfolio, or company page","X, LinkedIn, GitHub, or other relevant profile",How many people would actively work on this project?,Tell us about the team behind this proposal,What relevant skills or expertise does your team bring?,What best describes your current relationship with Decentraland?,Have you or your team previously shipped anything in Decentraland?,"If yes, tell us what you built in Decentraland",Why do you want to build this for Decentraland?,What similar projects have you or your team built before?,Links to relevant past work,How confident are you that your team can deliver this project within 90 days?,Which category are you applying to?,What kind of content proposal are you submitting?,Project title,What is the project?,How does this proposal embody the Mobile-first experiences theme?,"If this is based on an existing experience, share the link",What will users actually do in the experience?,Who is this experience for?,Why would this improve Decentraland?,What would be delivered within 90 days?,How would you measure success?,What kind of technical proposal are you submitting?,Project title,What is the project?,How does this proposal align with the AI-assisted tooling theme?,Who would use this tool or system?,What problem does this solve?,What would be delivered within 90 days?,How would this be shared as open-source work?,How would you measure success?,What is your estimated funding request in USD?,How did you estimate this budget?,What are the main milestones you expect across the 90-day period?,Is this project also receiving funding from another source?,"If yes, please explain",Upload or link a visual project overview,"Repository, prototype, or technical documentation",Is there anything else you would like us to know?,I confirm that the information submitted here is accurate to the best of my knowledge,I understand that the program is intended to support open-source work,I understand that DCL Regenesis Labs may contact me for follow-up questions or clarifications during review
01/04/2026 18:17:22,I understand and confirm,I understand and confirm,Studio/Company,CoBuilders,Lautaro Sole,lautaro@cobuilders.xyz,https://forum.decentraland.org/u/pollodumas,Uruguay,cobuilders.xyz,http://github.com/CoBuilders-xyz,3,"We are CoBuilders.","Node.js and TypeScript.",External studio,No,,Open architecture.,Similar work.,https://example.com,Very confident,Tech Ecosystem — AI-assisted tooling,,,,,,,,,,,"Library",AI Scene Controller,"A self-deployable AI orchestration system.","AI is central.","DCL developers.","Scenes are limited.","- Orchestrator","Released on GitHub.","- Deployments",15000,Engineering time.,"Phase 1",No,,,https://cobuilders.notion.site,"Extra notes.",I confirm,I understand,I understand`;
  const parsed = parseCsv(csv);
  assert.equal(parsed.rows.length, 1);
  const out = renderProposalTopic(parsed.rows[0]);
  assert.ok(out);
  assert.equal(out!.title, "AI Scene Controller — Tech Ecosystem");
  // Email is absent from the rendered topic
  assert.doesNotMatch(out!.body, /lautaro@cobuilders\.xyz/);
  // Bureaucracy acknowledgments are absent
  assert.doesNotMatch(out!.body, /I understand and confirm/);
  assert.doesNotMatch(out!.body, /I confirm that the information submitted/);
  // Project body rendered
  assert.match(out!.body, /self-deployable AI orchestration system/);
  assert.match(out!.body, /Engineering time/);
  assert.match(out!.body, /\*\*Other funding sources:\*\* None/);
  // Notes rendered as blockquote
  assert.match(out!.body, /> \*Extra notes\.\*/);
});
