export class DmScheduler {
  private queues = new Map<string, Array<() => Promise<void>>>();

  submit(userId: string, work: () => Promise<void>): { done: Promise<void>; position: number } {
    const queue = this.queues.get(userId);
    const position = queue ? queue.length + 1 : 0;

    let resolve!: () => void;
    const done = new Promise<void>((res) => (resolve = res));
    const wrapped = async () => { try { await work(); } finally { resolve(); } };

    if (!queue) {
      this.queues.set(userId, []);
      void this.drain(userId, wrapped);
    } else {
      queue.push(wrapped);
    }

    return { done, position };
  }

  private async drain(userId: string, first: () => Promise<void>): Promise<void> {
    await first();
    const queue = this.queues.get(userId)!;
    while (queue.length > 0) {
      await queue.shift()!();
    }
    this.queues.delete(userId);
  }
}

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
