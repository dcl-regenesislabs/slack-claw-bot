import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentScheduler, type SubmitResult } from "../src/concurrency.js";

function accepted(result: SubmitResult): asserts result is { status: "accepted"; done: Promise<void>; queued: boolean } {
  assert.ok(typeof result === "object" && result.status === "accepted");
}

describe("AgentScheduler", () => {
  it("runs accepted work", async () => {
    const scheduler = new AgentScheduler();
    let ran = false;
    const result = scheduler.submit("t1", async () => { ran = true; });
    accepted(result);
    await result.done;
    assert.ok(ran);
  });

  it("returns thread-busy for duplicate thread", () => {
    const scheduler = new AgentScheduler();
    scheduler.submit("t1", () => new Promise(() => {})); // never resolves
    assert.equal(scheduler.submit("t1", async () => {}), "thread-busy");
  });

  it("allows reuse after completion", async () => {
    const scheduler = new AgentScheduler();
    const r1 = scheduler.submit("t1", async () => {});
    accepted(r1);
    await r1.done;
    const r2 = scheduler.submit("t1", async () => {});
    accepted(r2);
    await r2.done;
  });

  it("respects maxConcurrent by queuing excess work", async () => {
    const scheduler = new AgentScheduler(1);
    const order: number[] = [];
    let resolve1!: () => void;
    const blocker = new Promise<void>((r) => { resolve1 = r; });

    const r1 = scheduler.submit("t1", async () => { await blocker; order.push(1); });
    accepted(r1);

    const r2 = scheduler.submit("t2", async () => { order.push(2); });
    accepted(r2);

    // t2 should be queued, not running yet
    resolve1();
    await r1.done;
    await r2.done;
    assert.deepEqual(order, [1, 2]);
  });

  it("queues excess work instead of rejecting", async () => {
    const scheduler = new AgentScheduler(1);
    const order: number[] = [];
    let resolve1!: () => void;
    const blocker = new Promise<void>((r) => { resolve1 = r; });

    const r1 = scheduler.submit("t1", async () => { await blocker; order.push(1); });
    accepted(r1);
    assert.equal(r1.queued, false);

    const r2 = scheduler.submit("t2", async () => { order.push(2); });
    accepted(r2);
    assert.equal(r2.queued, true);

    const r3 = scheduler.submit("t3", async () => { order.push(3); });
    accepted(r3);
    assert.equal(r3.queued, true);

    resolve1();
    await r1.done;
    await r2.done;
    await r3.done;
    assert.deepEqual(order, [1, 2, 3]);
  });

  it("propagates errors from work", async () => {
    const scheduler = new AgentScheduler();
    const result = scheduler.submit("t1", async () => { throw new Error("boom"); });
    accepted(result);
    await assert.rejects(result.done, { message: "boom" });
  });

  it("frees thread on throw", async () => {
    const scheduler = new AgentScheduler();
    const r1 = scheduler.submit("t1", async () => { throw new Error("boom"); });
    accepted(r1);
    await r1.done.catch(() => {});
    const r2 = scheduler.submit("t1", async () => {});
    accepted(r2);
    await r2.done;
  });
});
