// Phase 0 (shadow mode) poll resolver. On a timer it finds governance polls stuck
// in `Finished`, classifies each (deterministic pre-filter → LLM for the ambiguous
// tail), and posts to a Slack channel what it WOULD do — without taking any action.
// This validates the classifier against real DAO Council decisions before any write
// authority is granted. See ~/Documents/poll-auto-resolution-plan.md.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { WebClient } from "@slack/web-api";
import { runAgent } from "./agent.js";
import { GovernanceClient, type GovernanceProposal } from "./governance.js";
import {
  aggregateVotes,
  buildClassificationPrompt,
  deterministicOutcome,
  parseVerdict,
  winningChoice,
  type ChoiceTally,
  type PollOutcome,
  type Verdict,
} from "./poll-outcome.js";

type ClassifyMethod = "deterministic" | "llm" | "undetermined";
type DecisionStatus = "shadow-announced" | "needs-human" | "error";

interface PollDecisionState {
  pollId: string;
  title: string;
  snapshotId: string;
  outcome: PollOutcome | null;
  method: ClassifyMethod;
  confidence: number;
  rationale: string;
  winningChoice: string | null;
  winningPower: number;
  /** shadow mode never executes — this only records what was announced. */
  status: DecisionStatus;
  channelId: string;
  announcedTs?: string;
  classifiedAt: string;
}

export interface PollResolverOptions {
  governance: GovernanceClient;
  client: WebClient;
  channelId: string;
  memoryDir: string;
  /** Below this, an LLM verdict is announced as "needs human review" rather than a confident call. */
  confidenceThreshold: number;
  /** Optional model override for the classifier (defaults to the bot's default model). */
  model?: string;
}

interface Classification {
  outcome: PollOutcome | null;
  method: ClassifyMethod;
  confidence: number;
  rationale: string;
}

export class PollResolver {
  private readonly seen = new Map<string, PollDecisionState>();
  private readonly pollsDir: string;
  private ticking = false;

  constructor(private readonly opts: PollResolverOptions) {
    this.pollsDir = join(opts.memoryDir, "polls");
    mkdirSync(this.pollsDir, { recursive: true });
    this.loadState();
    console.log(`[polls] Bootstrap complete — ${this.seen.size} poll(s) already processed`);
  }

  /** One scheduler pass: discover fresh finished polls, classify, announce (shadow). */
  async tick(): Promise<void> {
    if (this.ticking) {
      console.warn("[polls] Previous tick still running — skipping");
      return;
    }
    this.ticking = true;
    try {
      const polls = await this.opts.governance.fetchFinishedPolls();
      const fresh = polls.filter((p) => !this.seen.has(p.id));
      if (fresh.length === 0) {
        console.log(`[polls] ${polls.length} finished poll(s), none new`);
        return;
      }
      console.log(`[polls] ${fresh.length} new finished poll(s) to classify`);
      for (const poll of fresh) {
        try {
          await this.processPoll(poll);
        } catch (err) {
          console.error(`[polls] Failed to process poll ${poll.id}:`, err);
          // Record it so a transient failure doesn't re-announce forever on the next tick.
          this.record({
            pollId: poll.id,
            title: poll.title,
            snapshotId: poll.snapshot_id,
            outcome: null,
            method: "undetermined",
            confidence: 0,
            rationale: (err as Error).message,
            winningChoice: null,
            winningPower: 0,
            status: "error",
            channelId: this.opts.channelId,
            classifiedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error("[polls] Tick failed:", err);
    } finally {
      this.ticking = false;
    }
  }

  private async processPoll(poll: GovernanceProposal): Promise<void> {
    // The list item may omit description; fetch full detail for the classifier.
    const detail = await this.opts.governance.fetchProposal(poll.id);
    const choices = detail.configuration?.choices ?? [];
    const votes = await this.opts.governance.fetchVotes(poll.id);
    const tallies = aggregateVotes(choices, votes);
    const winner = winningChoice(tallies);

    const classification = await this.classify(detail, choices, tallies, winner);

    const confident =
      classification.outcome !== null &&
      (classification.method === "deterministic" || classification.confidence >= this.opts.confidenceThreshold);
    const status: DecisionStatus = confident ? "shadow-announced" : "needs-human";

    const announcedTs = await this.announce(detail, winner, classification, status);

    this.record({
      pollId: detail.id,
      title: detail.title,
      snapshotId: detail.snapshot_id,
      outcome: classification.outcome,
      method: classification.method,
      confidence: classification.confidence,
      rationale: classification.rationale,
      winningChoice: winner?.choice ?? null,
      winningPower: winner?.power ?? 0,
      status,
      channelId: this.opts.channelId,
      announcedTs,
      classifiedAt: new Date().toISOString(),
    });
  }

  private async classify(
    detail: GovernanceProposal,
    choices: string[],
    tallies: ChoiceTally[],
    winner: ChoiceTally | null,
  ): Promise<Classification> {
    const deterministic = deterministicOutcome(choices, tallies);
    if (deterministic) {
      return { outcome: deterministic.outcome, method: "deterministic", confidence: 1, rationale: deterministic.reason };
    }
    if (!winner) {
      return { outcome: null, method: "undetermined", confidence: 0, rationale: "no votes / no winning option" };
    }
    const verdict = await this.classifyWithLLM(detail, tallies, winner);
    if (!verdict) {
      return { outcome: null, method: "undetermined", confidence: 0, rationale: "classifier returned no parseable verdict" };
    }
    return { outcome: verdict.outcome, method: "llm", confidence: verdict.confidence, rationale: verdict.rationale };
  }

  private async classifyWithLLM(
    detail: GovernanceProposal,
    tallies: ChoiceTally[],
    winner: ChoiceTally,
  ): Promise<Verdict | null> {
    const { system, user } = buildClassificationPrompt(detail, tallies, winner);
    const result = await runAgent({
      threadTs: `poll-${detail.id}`,
      eventTs: `poll-${detail.id}`,
      userId: "poll-resolver",
      username: "poll-resolver",
      newMessage: user,
      fetchThread: async () => user,
      fetchThreadSince: async () => "",
      systemPrompt: system,
      sessionManager: SessionManager.inMemory(),
      isResumed: false,
      skipMemorySave: true,
      skipMemoryLoad: true,
      tools: [], // text-only: the classifier gets no bash/fs/web tools
      model: this.opts.model,
    });
    await result.done.catch(() => {});
    const verdict = parseVerdict(result.text);
    if (!verdict) {
      console.warn(`[polls] Unparseable verdict for ${detail.id}: ${result.text.slice(0, 200)}`);
    }
    return verdict;
  }

  private async announce(
    detail: GovernanceProposal,
    winner: ChoiceTally | null,
    c: Classification,
    status: DecisionStatus,
  ): Promise<string | undefined> {
    const url = this.opts.governance.proposalUrl(detail.id);
    const header =
      status === "shadow-announced"
        ? ":ballot_box_with_ballot: *Poll ended — shadow mode (no action taken)*"
        : ":warning: *Poll ended — needs a human decision (shadow mode)*";

    const winnerLine = winner
      ? `Winner: "${winner.choice}" — ${Math.round(winner.power).toLocaleString()} VP`
      : "Winner: _could not determine (no votes)_";

    const basis =
      c.method === "deterministic"
        ? `_Basis: rule — ${c.rationale}_`
        : c.method === "llm"
          ? `_Basis: LLM (confidence ${c.confidence.toFixed(2)}) — ${c.rationale}_`
          : `_Basis: undetermined — ${c.rationale}_`;

    const call =
      c.outcome && status === "shadow-announced"
        ? `I *would* mark this *${c.outcome.toUpperCase()}*.`
        : c.outcome
          ? `Best guess: *${c.outcome.toUpperCase()}* — but I'm not confident, please review.`
          : `I can't determine an outcome — please review.`;

    const text = [
      header,
      `*${detail.title}*  (\`${detail.id}\`)`,
      `<${url}|View proposal>`,
      "",
      winnerLine,
      call,
      basis,
    ].join("\n");

    try {
      const res = await this.opts.client.chat.postMessage({ channel: this.opts.channelId, text });
      return res.ts;
    } catch (err) {
      console.error(`[polls] Failed to announce poll ${detail.id}:`, err);
      return undefined;
    }
  }

  private record(state: PollDecisionState): void {
    this.seen.set(state.pollId, state);
    this.saveState(state);
  }

  private loadState(): void {
    if (!existsSync(this.pollsDir)) return;
    for (const entry of readdirSync(this.pollsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const statePath = join(this.pollsDir, entry.name, "state.json");
      if (!existsSync(statePath)) continue;
      try {
        const state = JSON.parse(readFileSync(statePath, "utf-8")) as PollDecisionState;
        if (state?.pollId) this.seen.set(state.pollId, state);
      } catch (err) {
        console.warn(`[polls] Failed to load poll ${entry.name}:`, (err as Error).message);
      }
    }
  }

  private saveState(state: PollDecisionState): void {
    const dir = join(this.pollsDir, state.pollId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "state.json");
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmp, path);
  }
}

export interface PollResolverHandle {
  stop(): void;
}

/**
 * Kick off the recurring resolver: an initial tick shortly after startup, then one
 * every `intervalMs`. Returns a handle whose `stop()` clears both timers for graceful
 * shutdown.
 */
export function startPollResolver(resolver: PollResolver, intervalMs: number): PollResolverHandle {
  const run = () => {
    resolver.tick().catch((err) => console.error("[polls] Unhandled tick error:", err));
  };
  const kickoff = setTimeout(run, 5_000);
  const interval = setInterval(run, intervalMs);
  return {
    stop() {
      clearTimeout(kickoff);
      clearInterval(interval);
    },
  };
}
