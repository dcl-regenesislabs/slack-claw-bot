import { SessionManager } from "@mariozechner/pi-coding-agent";
import { runAgent } from "./agent.js";

/**
 * Forum-focused distillers. Internal Slack threads keep the full agent output;
 * these turn it into concise, human-readable Discourse posts before publishing.
 */

const TOPIC_SYSTEM_PROMPT = `You are a precise summarizer for a Decentraland grants review forum.
Given a grant proposal (raw text or a CSV export rendered as markdown bullets), produce a Discourse topic that reviewers can read end-to-end in about a minute.

Return a JSON object with exactly two fields:
- "title": a 5-10 word human-readable title for the topic (plain text, no markdown, no quotes). Use the project name if present; otherwise a short phrase describing the project.
- "body": a markdown block matching this exact shape (omit any section whose data is not in the proposal — do NOT invent filler):

**Applicant**: <name or studio> (<@forum-username> if provided)
**Contact**: <email>
**Links**: <website / GitHub / X / LinkedIn — whichever are actually given, comma-separated>
**Country**: <country or region>
**Requested**: <amount with currency>
**Track**: <category/track if stated>
**Team size**: <N people>

## Summary

<1-2 paragraphs — what they want to build, who it's for, why it matters. 120-180 words. Do NOT invent details not in the proposal.>

## Team

<1-3 sentences summarizing the team description from the proposal. Skip if not provided.>

## Deliverables / Milestones

<bullet list of concrete things they will ship, with dates/durations if given. Skip if not provided.>

## Timeline

<brief timeline or delivery schedule if stated. Skip if not provided.>

## Budget breakdown

<bullet list of line items with amounts if the proposal itemises the budget. Skip if only a total is given.>

## Success metrics

<what they will measure / KPIs, if stated. Skip if not provided.>

RULES:
- Output ONLY the JSON object, no prose, no code fences.
- Include a section ONLY if the proposal actually contains data for it — do not pad with "Not specified" or empty bullets.
- Use Discourse-compatible markdown; no HTML.
- Quote the applicant's own specifics (numbers, names, durations) — don't generalise.
- If there are multiple contradictions or unclear numbers in the proposal, surface both rather than picking one.`;

const AGENT_SYSTEM_PROMPT = (agentLabel: string) => `You are a precise summarizer for a Decentraland grants review forum.
Given a full evaluation from the ${agentLabel} agent, produce a concise Discourse forum post.

Return the markdown body ONLY (no JSON, no code fences, no preamble), matching this shape:

**Assessment**: <2-3 sentences — the agent's conclusion and the top concern or strength>

### Questions for the applicant

1. <specific, answerable question>
2. <specific, answerable question>
3. <specific, answerable question>
<up to 5 questions total>

RULES:
- Extract ONLY the substantive findings and the real questions.
- Questions must be specific and directly answerable by the applicant (not rhetorical, not "consider…").
- Do not include the agent's heading or persona intro.
- Start directly with "**Assessment**:" — no preamble.
- No code fences, no explanations, no XML.`;

const ORACLE_SYSTEM_PROMPT = `You are a precise summarizer for a Decentraland grants review forum.
Given ORACLE's synthesis of 4 domain evaluations, produce a concise Discourse forum post with the final recommendation.

Return the markdown body ONLY (no JSON, no code fences, no preamble), matching this shape:

**Recommendation**: FUND / CONDITIONAL / NO FUND

## Summary

<1-2 paragraphs synthesizing the key factors driving the decision. Under 150 words.>

### Conditions / Next steps

- <bullet for each condition or next step, 3-5 max>

RULES:
- Use FUND / CONDITIONAL / NO FUND verbatim — one of those three.
- Do not include ORACLE's intro or persona.
- If the recommendation is FUND with no conditions, write "- None" under Conditions / Next steps.
- Start directly with "**Recommendation**:" — no preamble.`;

async function runDistiller(systemPrompt: string, content: string, label: string): Promise<string> {
  const ts = `distill-${label}-${Date.now()}`;
  const result = await runAgent({
    threadTs: ts,
    eventTs: ts,
    userId: "grants-distiller",
    username: `DISTILL-${label.toUpperCase()}`,
    newMessage: content,
    fetchThread: async () => content,
    fetchThreadSince: async () => "",
    systemPrompt,
    sessionManager: SessionManager.inMemory(),
    isResumed: false,
    skipMemorySave: true,
    skipMemoryLoad: true,
  });
  await result.done.catch(() => {});
  return (result.text || "").trim();
}

export interface DistilledTopic {
  title: string;
  body: string;
}

export async function distillTopic(proposalText: string): Promise<DistilledTopic> {
  const raw = await runDistiller(TOPIC_SYSTEM_PROMPT, proposalText, "topic");
  // Strip ``` fences if the model added them anyway
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("distillTopic: response is not an object");
  }
  const p = parsed as Record<string, unknown>;
  const title = typeof p.title === "string" ? p.title.trim() : "";
  const body = typeof p.body === "string" ? p.body.trim() : "";
  if (!title || !body) {
    throw new Error("distillTopic: response missing title or body");
  }
  return { title, body };
}

export async function distillAgent(agentLabel: string, evaluation: string): Promise<string> {
  return runDistiller(AGENT_SYSTEM_PROMPT(agentLabel), evaluation, `agent-${agentLabel}`);
}

export async function distillOracle(oracleText: string): Promise<string> {
  return runDistiller(ORACLE_SYSTEM_PROMPT, oracleText, "oracle");
}
