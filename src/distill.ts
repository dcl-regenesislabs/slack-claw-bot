import { SessionManager } from "@mariozechner/pi-coding-agent";
import { runAgent } from "./agent.js";

/**
 * Distills a raw grant proposal into the initial Discourse topic (title + body).
 * Agent and ORACLE evaluations are published verbatim on `!post`, so they don't
 * need a distiller.
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

export interface DistilledTopic {
  title: string;
  body: string;
}

export async function distillTopic(proposalText: string): Promise<DistilledTopic> {
  const ts = `distill-topic-${Date.now()}`;
  const result = await runAgent({
    threadTs: ts,
    eventTs: ts,
    userId: "grants-distiller",
    username: "DISTILL-TOPIC",
    newMessage: proposalText,
    fetchThread: async () => proposalText,
    fetchThreadSince: async () => "",
    systemPrompt: TOPIC_SYSTEM_PROMPT,
    sessionManager: SessionManager.inMemory(),
    isResumed: false,
    skipMemorySave: true,
    skipMemoryLoad: true,
    tools: [],
  });
  await result.done.catch(() => {});
  const raw = (result.text || "").trim();
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
