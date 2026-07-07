// Read-only client for the Decentraland governance API. Phase 0 (shadow mode)
// only reads — there is deliberately NO status-write method here yet. The write
// path (auto-executing Finished → Passed/Rejected) lands in a later phase behind
// a scoped, authenticated governance endpoint. See poll-auto-resolution-plan.md.

/** A choice index in a vote is 1-based into `configuration.choices`. */
export interface GovernanceVote {
  choice: number;
  vp: number;
  timestamp?: number;
}

export type VotesByAddress = Record<string, GovernanceVote>;

export interface GovernanceProposalConfiguration {
  choices: string[];
  [key: string]: unknown;
}

export interface GovernanceProposal {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string;
  snapshot_id: string;
  required_to_pass: number | null;
  finish_at: string;
  start_at: string;
  configuration: GovernanceProposalConfiguration;
}

interface ApiResponse<T> {
  ok: boolean;
  data: T;
  total?: number;
}

export class GovernanceError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "GovernanceError";
  }
}

export class GovernanceClient {
  /** API base, e.g. https://governance.decentraland.org/api */
  private readonly baseUrl: string;
  /** App base (API base minus the trailing /api), for user-facing proposal links. */
  readonly appUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.appUrl = this.baseUrl.replace(/\/api$/, "");
  }

  /** Public, unauthenticated link to the proposal page. */
  proposalUrl(id: string): string {
    return `${this.appUrl}/proposal/?id=${id}`;
  }

  /**
   * Polls that closed voting but whose custom options the backend could not
   * mechanically resolve sit in `status=finished` awaiting a manual decision.
   */
  async fetchFinishedPolls(limit = 100): Promise<GovernanceProposal[]> {
    const res = await this.request<ApiResponse<GovernanceProposal[]>>(
      `/proposals?type=poll&status=finished&order=DESC&limit=${limit}&offset=0`,
    );
    return res.data ?? [];
  }

  async fetchProposal(id: string): Promise<GovernanceProposal> {
    const res = await this.request<ApiResponse<GovernanceProposal>>(`/proposals/${id}`);
    return res.data;
  }

  /** Raw per-voter votes. The caller aggregates voting power per choice itself. */
  async fetchVotes(id: string): Promise<VotesByAddress> {
    const res = await this.request<ApiResponse<VotesByAddress>>(`/proposals/${id}/votes`);
    return res.data ?? {};
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (errText) {
        console.error(`[governance] GET ${path} body:`, errText.slice(0, 1000));
      }
      throw new GovernanceError(
        `Governance GET ${path} failed: ${res.status} ${res.statusText}`,
        res.status,
      );
    }
    const json: unknown = await res.json();
    return json as T;
  }
}
