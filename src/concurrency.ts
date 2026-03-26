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
  | { status: "queued-behind-thread"; done: Promise<void> }
  | { status: "accepted"; done: Promise<void>; queued: boolean; queuePosition: number; estimatedWaitSec: number };

export class AgentScheduler {
  private activeThreads = new Set<string>();
  private threadQueues = new Map<string, Array<() => Promise<void>>>();
  private running = 0;
  private waitQueue: Array<() => void> = [];
  private maxConcurrent: number;
  private drainResolvers: Array<() => void> = [];

  /** Rolling average of processing time in seconds */
  private totalProcessingSec = 0;
  private completedCount = 0;

  /** Callback invoked when a queued item starts executing */
  onDequeued?: (threadId: string) => void;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  get avgProcessingSec(): number {
    return this.completedCount > 0
      ? this.totalProcessingSec / this.completedCount
      : 60; // default estimate: 60s
  }

  get queueLength(): number {
    return this.waitQueue.length;
  }

  submit(threadId: string, work: () => Promise<void>): SubmitResult {
    // If this thread already has active work, queue behind it
    if (this.activeThreads.has(threadId)) {
      const done = this.enqueueForThread(threadId, work);
      return { status: "queued-behind-thread", done };
    }

    const queuePosition = this.waitQueue.length;
    const queued = this.running >= this.maxConcurrent;
    const estimatedWaitSec = queued
      ? Math.round(((queuePosition + 1) / this.maxConcurrent) * this.avgProcessingSec)
      : 0;

    this.activeThreads.add(threadId);
    const done = this.execute(threadId, work);

    return { status: "accepted", done, queued, queuePosition, estimatedWaitSec };
  }

  private enqueueForThread(threadId: string, work: () => Promise<void>): Promise<void> {
    let queue = this.threadQueues.get(threadId);
    if (!queue) {
      queue = [];
      this.threadQueues.set(threadId, queue);
    }
    return new Promise<void>((resolve, reject) => {
      queue!.push(async () => {
        try { await work(); resolve(); } catch (err) { reject(err); }
      });
    });
  }

  private async execute(threadId: string, work: () => Promise<void>): Promise<void> {
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
      // Notify that this queued item is now starting
      this.onDequeued?.(threadId);
    }

    this.running++;
    const startTime = Date.now();
    try {
      await work();
    } finally {
      const elapsedSec = (Date.now() - startTime) / 1000;
      this.totalProcessingSec += elapsedSec;
      this.completedCount++;

      this.running--;
      await this.finishThread(threadId);
      this.waitQueue.shift()?.();
      this.drainResolvers.forEach((r) => {
        if (this.running === 0) r();
      });
    }
  }

  private async finishThread(threadId: string): Promise<void> {
    // Run any work queued behind this thread
    const queue = this.threadQueues.get(threadId);
    if (queue && queue.length > 0) {
      while (queue.length > 0) {
        await queue.shift()!();
      }
    }
    this.threadQueues.delete(threadId);
    this.activeThreads.delete(threadId);
  }

  /** Wait for all active work to complete, with optional timeout */
  drain(timeoutMs = 20_000): Promise<void> {
    if (this.running === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`[scheduler] Drain timed out after ${timeoutMs}ms with ${this.running} still running`);
        resolve();
      }, timeoutMs);
      this.drainResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
