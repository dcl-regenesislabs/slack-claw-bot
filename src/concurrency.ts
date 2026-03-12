export type SubmitResult =
  | "thread-busy"
  | { status: "accepted"; done: Promise<void>; queued: boolean };

export class AgentScheduler {
  private activeThreads = new Set<string>();
  private running = 0;
  private waitQueue: Array<() => void> = [];
  private maxConcurrent: number;
  private drainResolvers: Array<() => void> = [];

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  submit(threadId: string, work: () => Promise<void>): SubmitResult {
    if (this.activeThreads.has(threadId)) {
      return "thread-busy";
    }

    const queued = this.running >= this.maxConcurrent;
    this.activeThreads.add(threadId);
    const done = this.execute(threadId, work);

    return { status: "accepted", done, queued };
  }

  async drain(timeoutMs: number): Promise<void> {
    // Use activeThreads — it's the authoritative "work in flight" tracker.
    // Unlike `running`, it has no async gap between queue handoff and increment.
    if (this.activeThreads.size === 0) return;

    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.drainResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async execute(threadId: string, work: () => Promise<void>): Promise<void> {
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    }

    this.running++;
    try {
      await work();
    } finally {
      this.running--;
      this.activeThreads.delete(threadId);
      this.waitQueue.shift()?.();

      // Use activeThreads.size — not running — to avoid the race where a queued
      // job has been woken (shift above) but hasn't incremented running++ yet.
      if (this.activeThreads.size === 0 && this.drainResolvers.length > 0) {
        for (const resolve of this.drainResolvers.splice(0)) resolve();
      }
    }
  }
}
