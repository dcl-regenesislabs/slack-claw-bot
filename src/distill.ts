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
You receive the current content from the ${agentLabel} agent. It may be a full evaluation, a questions-only list, or a refined fragment from iteration — you render whatever is there into the forum shape below. You never refuse, never explain the input, never ask meta-questions.

Return the markdown body ONLY (no JSON, no code fences, no preamble), in this exact shape:

**Assessment**: <1-3 sentences — the agent's conclusion or, if only questions are provided, a one-line framing sentence describing what the questions are probing>

### Questions for the applicant

1. <specific, answerable question>
<keep as many questions as the input actually contains — render 1 if there's 1, render 7 if there are 7. Do NOT invent or pad questions.>

RULES:
- Extract ONLY the questions present in the input. Do not fabricate questions that aren't there.
- Questions must be answerable by the applicant (not rhetorical).
- Do not include the agent's heading or persona intro.
- Always start with "**Assessment**:" followed by your summary sentence. Even if the input is only questions, produce a framing sentence.
- No code fences, no XML, no meta commentary about the input format.`;

const ORACLE_SYSTEM_PROMPT = `You are a precise summarizer for a Decentraland grants review forum.
You receive ORACLE's current content — may be a full synthesis or a refined fragment after iteration. You render whatever is there into the forum shape below. You never refuse, never explain the input, never ask meta-questions.

Return the markdown body ONLY (no JSON, no code fences, no preamble), in this exact shape:

**Recommendation**: FUND / CONDITIONAL / NO FUND

## Summary

<1-2 paragraphs synthesizing the key factors driving the decision. Under 150 words.>

### Conditions / Next steps

- <bullet for each condition or next step, 3-5 max>

RULES:
- Use FUND / CONDITIONAL / NO FUND verbatim — pick whichever best matches the input content.
- Do not include ORACLE's intro or persona.
- If the recommendation is FUND with no conditions, write "- None" under Conditions / Next steps.
- Always start with "**Recommendation**:" — no preamble.
- No code fences, no XML, no meta commentary about the input format.`;

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
  const out = await runDistiller(AGENT_SYSTEM_PROMPT(agentLabel), evaluation, `agent-${agentLabel}`);
  assertShape(out, /\*\*Assessment\*\*:/, "agent distillation");
  return out;
}

export async function distillOracle(oracleText: string): Promise<string> {
  const out = await runDistiller(ORACLE_SYSTEM_PROMPT, oracleText, "oracle");
  assertShape(out, /\*\*Recommendation\*\*:/, "oracle distillation");
  return out;
}

/** Reject distiller output that doesn't match the required shape (e.g. refusals,
 * meta commentary). The caller catches and falls back to the raw input. */
function assertShape(output: string, marker: RegExp, context: string): void {
  if (!marker.test(output)) {
    throw new Error(`${context} produced output without required marker ${marker}; got: ${output.slice(0, 200)}`);
  }
}
