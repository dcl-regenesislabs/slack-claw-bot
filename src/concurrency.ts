export type SubmitResult =
  | "thread-busy"
  | "queue-full"
  | { status: "accepted"; done: Promise<void> };

export class AgentScheduler {
  private activeThreads = new Set<string>();
  private running = 0;
  private waitQueue: Array<() => void> = [];
  private maxConcurrent: number;
  private maxQueue: number;

  constructor(maxConcurrent = 3, maxQueue = 10) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;
  }

  submit(threadId: string, work: () => Promise<void>): SubmitResult {
    if (this.activeThreads.has(threadId)) {
      return "thread-busy";
    }

    if (this.running >= this.maxConcurrent && this.waitQueue.length >= this.maxQueue) {
      return "queue-full";
    }

    this.activeThreads.add(threadId);
    const done = this.execute(threadId, work);

    return { status: "accepted", done };
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
