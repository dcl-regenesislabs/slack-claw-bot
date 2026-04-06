export type SubmitResult =
  | { status: "accepted"; done: Promise<void>; queued: boolean }
  | { status: "queued-behind-thread"; done: Promise<void> };

export class AgentScheduler {
  private activeThreads = new Set<string>();
  private threadQueues = new Map<string, Array<() => Promise<void>>>();
  private running = 0;
  private waitQueue: Array<() => void> = [];
  private maxConcurrent: number;
  private drainResolvers: Array<() => void> = [];

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  submit(threadId: string, work: () => Promise<void>): SubmitResult {
    if (this.activeThreads.has(threadId)) {
      const done = this.enqueueForThread(threadId, work);
      return { status: "queued-behind-thread", done };
    }

    const queued = this.running >= this.maxConcurrent;
    this.activeThreads.add(threadId);
    const done = this.execute(threadId, work);

    return { status: "accepted", done, queued };
  }

  async drain(timeoutMs: number): Promise<void> {
    if (this.activeThreads.size === 0) return;

    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.drainResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private enqueueForThread(threadId: string, work: () => Promise<void>): Promise<void> {
    let queue = this.threadQueues.get(threadId);
    if (!queue) {
      queue = [];
      this.threadQueues.set(threadId, queue);
    }
    return new Promise<void>((resolve, reject) => {
      queue.push(async () => {
        try {
          await work();
          resolve();
        } catch (err) {
          reject(err);
        }
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
      this.drainThread(threadId);
    }
  }

  private drainThread(threadId: string): void {
    const queue = this.threadQueues.get(threadId);
    const next = queue?.shift();
    if (queue?.length === 0) this.threadQueues.delete(threadId);

    if (next) {
      this.running++;
      next().finally(() => {
        this.running--;
        this.drainThread(threadId);
      });
    } else {
      this.activeThreads.delete(threadId);
      this.releaseWaiter();
      this.checkDrain();
    }
  }

  private releaseWaiter(): void {
    this.waitQueue.shift()?.();
  }

  private checkDrain(): void {
    if (this.activeThreads.size === 0 && this.drainResolvers.length > 0) {
      for (const resolve of this.drainResolvers.splice(0)) resolve();
    }
  }
}
