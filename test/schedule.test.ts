import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  firesTooOften,
  validateSchedule,
  pushScheduleState,
  schedulesFilePath,
  statsFilePath,
  type Schedule,
  type ScheduleRunner,
} from "../src/schedule.js";
import { isProtectedPath } from "../src/agent.js";

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
    setFailPush: (fail: boolean) => void;
  }

  function makeRunner(startIso = "2026-03-10T12:00:30Z"): Harness {
    let currentNow = new Date(startIso);
    const fired: Schedule[] = [];
    const posts: Array<{ channel: string; text: string }> = [];
    const pushes: boolean[] = [];
    let failPush = false;
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
        if (failPush) throw new Error("push failed");
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
      setFailPush: (fail) => {
        failPush = fail;
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

  describe("firesTooOften", () => {
    it("flags sub-5-minute crons and allows 5-minute-plus crons", () => {
      const from = new Date("2026-03-10T12:00:30Z");
      assert.equal(firesTooOften("* * * * *", from), true);
      assert.equal(firesTooOften("*/5 * * * *", from), false);
      assert.equal(firesTooOften("0 12 * * *", from), false);
    });
  });

  describe("validateSchedule", () => {
    it("accepts channel ids for channels, groups, and DMs", () => {
      for (const channel of ["C0123ABCD", "G0123ABCD", "D0123ABCD"]) {
        assert.equal(validateSchedule(makeSchedule({ channel })), null);
      }
    });

    it("rejects malformed channels and non-string fields", () => {
      assert.ok(validateSchedule(makeSchedule({ channel: "evil" })));
      assert.ok(validateSchedule(makeSchedule({ channel: "" })));
      assert.ok(validateSchedule(makeSchedule({ channel: "c0123abcd" })));
      assert.ok(validateSchedule(makeSchedule({ task: "  " })));
      assert.ok(validateSchedule(makeSchedule({ task: 42 as unknown as string })));
      assert.ok(validateSchedule(makeSchedule({ cron: null as unknown as string })));
      assert.ok(validateSchedule(makeSchedule({ id: "" })));
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

    it("never fires a schedule without a valid Slack channel id", async () => {
      writeSchedules([
        makeSchedule({ id: "nochan1", channel: "" }),
        makeSchedule({ id: "nochan2", channel: "not-a-channel" }),
      ]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce();
      assert.equal(h.fired.length, 0);
    });

    it("rejects crons that fire more often than every 5 minutes", async () => {
      writeSchedules([makeSchedule({ cron: "* * * * *" })]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce();
      assert.equal(h.fired.length, 0);
    });

    it("caps enabled schedules at 25 per tick", async () => {
      const many = Array.from({ length: 26 }, (_, i) =>
        makeSchedule({ id: `id${String(i).padStart(4, "0")}` }),
      );
      writeSchedules(many);
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce();
      await h.runner.drain(5_000);
      assert.equal(h.fired.length, 25);
    });

    it("skips (not queues) a fire while the previous run is in flight", async () => {
      writeSchedules([makeSchedule({ cron: "*/5 * * * *" })]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      let release!: () => void;
      h.setRunTask(() => new Promise<string>((resolve) => {
        release = () => resolve("late result");
      }));
      await h.runner.tickOnce();
      h.setNow("2026-03-10T12:05:30Z");
      await h.runner.tickOnce();
      assert.equal(h.fired.length, 1);
      release();
      await h.runner.drain(1_000);
    });

    it("skips a fire already covered by persisted stats (restart dedupe)", async () => {
      writeSchedules([makeSchedule()]);
      recordRunStats(statsFilePath(memoryDir), "a1b2c3", "ok", new Date("2026-03-10T12:00:10Z"));
      const h = makeRunner("2026-03-10T12:00:40Z");
      await h.runner.tickOnce();
      assert.equal(h.fired.length, 0);
    });

    it("keys stats off fire time so a long run does not eat the next fire", async () => {
      writeSchedules([makeSchedule({ cron: "*/5 * * * *" })]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      let release!: () => void;
      h.setRunTask(() => new Promise<string>((resolve) => {
        release = () => resolve("slow result");
      }));
      await h.runner.tickOnce();
      // the run drags on and completes just inside the next fire's dedupe window
      h.setNow("2026-03-10T12:04:50Z");
      release();
      await h.runner.drain(1_000);
      assert.equal(readStats(statsFilePath(memoryDir))["a1b2c3"].lastRunAt, "2026-03-10T12:00:30.000Z");

      h.setRunTask(async () => "quick");
      h.setNow("2026-03-10T12:05:30Z");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.equal(h.fired.length, 2);
    });
  });

  describe("run outcomes", () => {
    it("suppresses the post on NO_OUTPUT and records a no-output run", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      h.setRunTask(async () => "NO_OUTPUT");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.equal(h.posts.length, 0);
      const stats = readStats(statsFilePath(memoryDir));
      assert.equal(stats["a1b2c3"].runCount, 1);
      assert.equal(stats["a1b2c3"].lastRunStatus, "no output");
    });

    it("records the first-line NO_OUTPUT reason, redacted and truncated", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      const reason = `sprint has not ended (token=xoxb-A1B2C3D4E5F6G7H8) ${"detail ".repeat(50)}`;
      h.setRunTask(async () => `NO_OUTPUT: ${reason}\nsecond line ignored`);
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.equal(h.posts.length, 0);
      const status = readStats(statsFilePath(memoryDir))["a1b2c3"].lastRunStatus!;
      assert.ok(status.startsWith("no output: sprint has not ended"));
      assert.ok(!status.includes("xoxb"));
      assert.ok(!status.includes("second line"));
      assert.equal(status.length, "no output: ".length + 200);
    });

    it("treats an empty response as no output", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      h.setRunTask(async () => "   ");
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      assert.equal(h.posts.length, 0);
      assert.equal(readStats(statsFilePath(memoryDir))["a1b2c3"].lastRunStatus, "no output");
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

    it("redacts secrets in persisted error statuses", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      h.setRunTask(async () => {
        throw new Error("curl failed: https://x.test/?token=xoxb-A1B2C3D4E5F6G7H8");
      });
      await h.runner.tickOnce();
      await h.runner.drain(1_000);
      const status = readStats(statsFilePath(memoryDir))["a1b2c3"].lastRunStatus!;
      assert.ok(status.startsWith("error:"));
      assert.ok(!status.includes("xoxb"));
      assert.ok(status.includes("[REDACTED]"));
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
    it("does not push when nothing changed", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T13:30:30Z");
      await h.runner.tickOnce();
      assert.deepEqual(h.pushes, []);
    });

    it("pushes definition changes on the next tick, once", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T13:30:30Z");
      await h.runner.tickOnce();
      assert.deepEqual(h.pushes, []);
      writeSchedules([makeSchedule({ description: "edited" })]);
      await h.runner.tickOnce();
      assert.deepEqual(h.pushes, [false]);
      await h.runner.tickOnce();
      assert.deepEqual(h.pushes, [false]);
    });

    it("retries a failed push on the next tick", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T13:30:30Z");
      writeSchedules([makeSchedule({ description: "edited" })]);
      h.setFailPush(true);
      await h.runner.tickOnce();
      assert.deepEqual(h.pushes, [false]);
      h.setFailPush(false);
      await h.runner.tickOnce();
      assert.deepEqual(h.pushes, [false, false]);
      await h.runner.tickOnce();
      assert.deepEqual(h.pushes, [false, false]);
    });

    it("batches stats-only pushes to the interval, and flush pushes unconditionally", async () => {
      writeSchedules([makeSchedule()]);
      const h = makeRunner("2026-03-10T12:00:30Z");
      await h.runner.tickOnce(); // fires — stats become dirty
      await h.runner.drain(1_000);
      assert.deepEqual(h.pushes, []);
      h.setNow("2026-03-10T12:01:30Z");
      await h.runner.tickOnce();
      assert.deepEqual(h.pushes, []);
      h.setNow("2026-03-10T12:06:30Z");
      await h.runner.tickOnce();
      assert.deepEqual(h.pushes, [true]);
      await h.runner.flush();
      assert.deepEqual(h.pushes, [true, true]);
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

    it("redacts a token that straddles the truncation boundary", () => {
      const secret = "xoxb-A1B2C3D4E5F6G7H8";
      const text = formatSchedulePost("x".repeat(2991) + " " + secret, makeSchedule());
      assert.ok(!text.includes("xoxb"));
    });
  });

  describe("buildScheduleRunOptions", () => {
    it("builds an ephemeral, memory-skipping run scoped to the schedule", () => {
      const opts = buildScheduleRunOptions(makeSchedule(), memoryDir, new Date("2026-03-10T12:00:00Z"));
      assert.equal(opts.skipMemoryLoad, true);
      assert.equal(opts.skipMemorySave, true);
      assert.equal(opts.channelId, "C0123ABCD");
      assert.equal(opts.newMessage, "do the thing");
      assert.ok(opts.sessionManager);
      // non-U/W userId keeps the trusted slack_user_id header off the prompt
      assert.ok(!/^[UW][A-Z0-9]+$/.test(opts.userId));
    });

    it("withholds the schedule-management capability from scheduled runs", () => {
      const opts = buildScheduleRunOptions(makeSchedule(), memoryDir);
      // no trusted path header, and tools that guard both persistence dirs
      assert.equal(opts.schedulesFile, undefined);
      assert.equal(opts.tools?.length, 4);
      const guarded = [join(memoryDir, "schedules"), join(memoryDir, "skills")];
      assert.equal(isProtectedPath(schedulesFilePath(memoryDir), guarded), true);
      assert.equal(isProtectedPath(join(memoryDir, "skills", "evil", "SKILL.md"), guarded), true);
      assert.equal(isProtectedPath(join(memoryDir, "shared", "MEMORY.md"), guarded), false);
    });
  });
});

describe("pushScheduleState", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "sched-git-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf-8" });
  }

  function initFixture(): { origin: string; clone: string } {
    const origin = join(base, "origin.git");
    const clone = join(base, "mem");
    execFileSync("git", ["init", "--bare", origin], { encoding: "utf-8" });
    execFileSync("git", ["clone", origin, clone], { encoding: "utf-8" });
    git(clone, "config", "user.email", "test@example.com");
    git(clone, "config", "user.name", "test");
    git(clone, "commit", "--allow-empty", "-m", "init");
    git(clone, "push", "-u", "origin", "HEAD");
    mkdirSync(join(clone, "schedules"), { recursive: true });
    return { origin, clone };
  }

  it("commits and pushes schedule definitions", async () => {
    const { origin, clone } = initFixture();
    writeFileSync(schedulesFilePath(clone), JSON.stringify({ schedules: [] }), "utf-8");
    await pushScheduleState(clone, false);
    assert.ok(git(origin, "log", "--oneline").includes("schedules: update schedule state"));
  });

  it("keeps concurrently staged files out of the commit and still staged", async () => {
    const { clone } = initFixture();
    writeFileSync(join(clone, "unrelated.md"), "agent memory mid-write", "utf-8");
    git(clone, "add", "unrelated.md");
    writeFileSync(schedulesFilePath(clone), JSON.stringify({ schedules: [] }), "utf-8");
    await pushScheduleState(clone, false);
    const committed = git(clone, "show", "--name-only", "--format=", "HEAD").trim();
    assert.equal(committed, "schedules/schedules.json");
    assert.ok(git(clone, "status", "--porcelain").includes("A  unrelated.md"));
  });

  it("excludes stats until includeStats is set", async () => {
    const { clone } = initFixture();
    writeFileSync(schedulesFilePath(clone), JSON.stringify({ schedules: [] }), "utf-8");
    writeFileSync(statsFilePath(clone), "{}", "utf-8");
    await pushScheduleState(clone, false);
    assert.ok(git(clone, "status", "--porcelain").includes("?? schedules/schedule-stats.json"));
    await pushScheduleState(clone, true);
    assert.equal(git(clone, "status", "--porcelain").trim(), "");
  });

  it("resolves without side effects for a non-git directory", async () => {
    await pushScheduleState(base, true);
  });
});
