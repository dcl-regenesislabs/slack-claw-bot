export type SubmitResult =
  | "thread-busy"
  | { status: "accepted"; done: Promise<void>; queued: boolean };

export class AgentScheduler {
  private activeThreads = new Set<string>();
  private running = 0;
  private waitQueue: Array<() => void> = [];
  private maxConcurrent: number;

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
    }
  }
}
