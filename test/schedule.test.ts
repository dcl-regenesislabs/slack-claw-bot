import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  startScheduleRunner,
  buildScheduleRunOptions,
  formatSchedulePost,
  readSchedules,
  readStats,
  recordRunStats,
  isDue,
  schedulesFilePath,
  statsFilePath,
  type Schedule,
  type ScheduleRunner,
} from "../src/schedule.js";

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "a1b2c3",
    cron: "0 12 * * *",
    task: "do the thing",
    description: "Daily report",
    channel: "C0123ABCD",
    createdBy: "alice",
    createdAt: "2026-01-01T00:00:00Z",
    enabled: true,
    ...overrides,
  };
}

describe("schedule", () => {
  let memoryDir: string;
  let runner: ScheduleRunner | null;

  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), "sched-test-"));
    mkdirSync(join(memoryDir, "schedules"), { recursive: true });
    runner = null;
  });

  afterEach(() => {
    runner?.stop();
    rmSync(memoryDir, { recursive: true, force: true });
  });

  function writeSchedules(schedules: Schedule[]): void {
    writeFileSync(schedulesFilePath(memoryDir), JSON.stringify({ schedules }, null, 2), "utf-8");
  }

  interface Harness {
    runner: ScheduleRunner;
    fired: Schedule[];
    posts: Array<{ channel: string; text: string }>;
    pushes: boolean[];
    setNow: (iso: string) => void;
    setRunTask: (fn: (s: Schedule) => Promise<string>) => void;
  }

  function makeRunner(startIso = "2026-03-10T12:00:30Z"): Harness {
    let currentNow = new Date(startIso);
    const fired: Schedule[] = [];
    const posts: Array<{ channel: string; text: string }> = [];
    const pushes: boolean[] = [];
    let taskImpl: (s: Schedule) => Promise<string> = async () => "report body";
    runner = startScheduleRunner({
      memoryDir,
      runTask: (s) => {
        fired.push(s);
        return taskImpl(s);
      },
      postMessage: async (channel, text) => {
        posts.push({ channel, text });
      },
      now: () => currentNow,
      push: (includeStats) => {
        pushes.push(includeStats);
      },
    });
    return {
      runner,
      fired,
      posts,
      pushes,
      setNow: (iso) => {
        currentNow = new Date(iso);
      },
      setRunTask: (fn) => {
        taskImpl = fn;
      },
    };
  }

  describe("isDue", () => {
    it("is due when the cron time falls inside the window", () => {
      assert.equal(isDue("0 12 * * *", new Date("2026-03-10T12:00:30Z"), 60_000), true);
    });

    it("is not due when the cron time is outside the window", () => {
      assert.equal(isDue("0 12 * * *", new Date("2026-03-10T12:02:30Z"), 60_000), false);
    });

    it("evaluates in UTC regardless of process TZ", () => {
      assert.equal(isDue("0 12 * * *", new Date("2026-03-10T09:00:30-03:00"), 60_000), true);
    });

    it("throws on an invalid cron expression", () => {
      assert.throws(() => isDue("not a cron", new Date(), 60_000));
    });
  });

  describe("fail-open reads", () => {
    it("returns empty schedules for a missing file", () => {
      assert.deepEqual(readSchedules(join(memoryDir, "nope.json")), { schedules: [] });
    });

    it("returns empty schedules for a corrupt file", () => {
      const path = schedulesFilePath(memoryDir);
      writeFileSync(path, "{corrupt", "utf-8");
      assert.deepEqual(readSchedules(path), { schedules: [] });
    });

    it("returns empty stats for missing or corrupt stats", () => {
      assert.deepEqual(readStats(join(memoryDir, "nope.json")), {});
      const path = statsFilePath(memoryDir);
      writeFileSync(path, "{corrupt", "utf-8");
      assert.deepEqual(readStats(path), {});
    });
  });

  describe("tick", () => {
    it("fires a due schedule and posts the result", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.equal(h.fired.length, 1);
      assert.equal(h.posts.length, 1);
      assert.equal(h.posts[0].channel, "C0123ABCD");
      assert.ok(h.posts[0].text.includes("report body"));
    });

    it("fires exactly once across consecutive ticks", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      h.setNow("2026-03-10T12:01:30Z");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.equal(h.fired.length, 1);
    });

    it("does not fire a schedule that is not due", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T13:30:30Z");
      await h.runner.tickOnce();
      assert.equal(h.fired.length, 0);
    });

    it("does not fire a disabled schedule", async () => {
      writeSchedules([makeSchedule({ enabled: false })]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce();
      assert.equal(h.fired.length, 0);
    });

    it("an invalid cron does not break sibling schedules", async () => {
      writeSchedules([
        makeSchedule({ id: "bad001", cron: "not a cron" }),
        makeSchedule({ id: "good01" }),
      ]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.deepEqual(h.fired.map((s) => s.id), ["good01"]);
    });

    it("never fires a channel-less schedule", async () => {
      writeSchedules([makeSchedule({ channel: "" })]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce();
      assert.equal(h.fired.length, 0);
    });

    it("skips (not queues) a fire while the previous run is in flight", async () => {
      writeSchedules([makeSchedule({ cron: "* * * * *" })]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      let release: () => void;
      const gate = new Promise<string>((resolve) => {
        release = () => resolve("late result");
      });
      h.setRunTask(() => gate);
      await h.runner.tickOnce();
      h.setNow("2026-03-10T12:01:30Z");
      await h.runner.tickOnce();
      assert.equal(h.fired.length, 1);
      release!();
      await h.runner.drain(1_000);
    });

    it("skips a fire already covered by persisted stats (restart dedupe)", async () => {
      writeSchedules([makeSchedule()]);
      recordRunStats(statsFilePath(memoryDir), "a1b2c3", "ok", new Date("2026-03-10T12:00:10Z"));
      const h = makeRunner("2026-03-10T12:00:40Z");
      await h.runner.tickOnce();
      assert.equal(h.fired.length, 0);
    });
  });

  describe("run outcomes", () => {
    it("suppresses the post on NO_OUTPUT but records an ok run", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      h.setRunTask(async () => "NO_OUTPUT");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.equal(h.posts.length, 0);
      const stats = readStats(statsFilePath(memoryDir));
      assert.equal(stats["a1b2c3"].runCount, 1);
      assert.equal(stats["a1b2c3"].lastRunStatus, "ok");
    });

    it("records an error status and posts nothing when the run fails", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      h.setRunTask(async () => {
        throw new Error("boom");
      });
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.equal(h.posts.length, 0);
      const stats = readStats(statsFilePath(memoryDir));
      assert.equal(stats["a1b2c3"].lastRunStatus, "error: boom");
    });

    it("stats writes never touch schedules.json", async () => {
      writeSchedules([makeSchedule()]);
      const before = readFileSync(schedulesFilePath(memoryDir), "utf-8");
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.equal(readFileSync(schedulesFilePath(memoryDir), "utf-8"), before);
      assert.ok(existsSync(statsFilePath(memoryDir)));
    });
  });

  describe("push policy", () => {
    it("pushes without stats every tick, and with stats only after the batch interval", async () => {
      writeSchedules([makeSchedule({ cron: "* * * * *" })]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.deepEqual(h.pushes, [false]);

      // 1 minute later — stats dirty but batch interval (5 min) not reached
      h.setNow("2026-03-10T12:01:30Z");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.deepEqual(h.pushes, [false, false]);

      // past the batch interval — stats included
      h.setNow("2026-03-10T12:06:00Z");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.deepEqual(h.pushes, [false, false, true]);
    });

    it("flush pushes unconditionally with stats", () => {
      const h = makeRunner();
      h.runner.flush();
      assert.deepEqual(h.pushes, [true]);
    });
  });

  describe("formatSchedulePost", () => {
    it("appends the schedule footer", () => {
      const text = formatSchedulePost("hello", makeSchedule());
      assert.ok(text.startsWith("hello"));
      assert.ok(text.includes("_Schedule: Daily report · `0 12 * * *` · ID: a1b2c3_"));
    });

    it("truncates long bodies at 3000 chars", () => {
      const text = formatSchedulePost("x".repeat(5000), makeSchedule());
      assert.ok(text.includes("...(truncated)"));
      assert.ok(text.length < 3200);
    });

    it("converts markdown to mrkdwn", () => {
      const text = formatSchedulePost("**bold** [link](https://example.com)", makeSchedule());
      assert.ok(text.includes("*bold*"));
      assert.ok(text.includes("<https://example.com|link>"));
    });
  });

  describe("buildScheduleRunOptions", () => {
    it("builds an ephemeral, memory-skipping run scoped to the schedule", () => {
      const opts = buildScheduleRunOptions(makeSchedule(), new Date("2026-03-10T12:00:00Z"));
      assert.equal(opts.skipMemoryLoad, true);
      assert.equal(opts.skipMemorySave, true);
      assert.equal(opts.channelId, "C0123ABCD");
      assert.equal(opts.newMessage, "do the thing");
      assert.ok(opts.sessionManager);
      // non-U/W userId keeps the trusted slack_user_id header off the prompt
      assert.ok(!/^[UW][A-Z0-9]+$/.test(opts.userId));
    });
  });
});
