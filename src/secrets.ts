import { readFileSync } from "node:fs";
import { parse } from "dotenv";

/**
 * Deployed secrets must not travel through the container environment: `/proc/<pid>/environ`
 * is readable by every process of the same uid, allowlisting a child's env does not change
 * that, and `unsetenv` leaves the exec-time copy in place. So Compose starts the container as
 * root with only CAP_SETUID/CAP_SETGID, this reads the root-only `SECRETS_FILE`, and the
 * process drops to `RUN_AS`. The credential change also marks the process non-dumpable, which
 * is what keeps its environ and memory closed to the agent's shell despite the shared uid.
 *
 * Must run before anything touches `DATA_DIR` or `$HOME`: root here has no CAP_DAC_OVERRIDE,
 * and files created now would belong to the wrong uid.
 */
let done = false;

export function loadSecretsAndDropPrivileges(env: NodeJS.ProcessEnv = process.env): void {
  // Idempotent: the preload entry runs it first, index.ts again for plain `tsx src/index.ts`.
  if (done) return;
  done = true;
  if (env.SECRETS_FILE) {
    const parsed = parse(readFileSync(env.SECRETS_FILE));
    Object.assign(env, parsed);
    console.log(`[secrets] Loaded ${Object.keys(parsed).length} entries from ${env.SECRETS_FILE}`);
  }

  const uid = process.getuid?.();
  if (uid === undefined) return;
  if (uid !== 0) {
    if (env.RUN_AS) console.warn(`[secrets] RUN_AS is set but the process is already uid ${uid}`);
    return;
  }
  const target = parseRunAs(env.RUN_AS);
  if (!target) {
    throw new Error("Refusing to run as root: set RUN_AS=uid:gid (Compose does) or run the image as its node user");
  }
  process.setgroups!([]);
  process.setgid!(target.gid);
  process.setuid!(target.uid);
  if (process.getuid!() !== target.uid || process.geteuid!() !== target.uid || process.getgid!() !== target.gid) {
    throw new Error("Privilege drop did not take effect");
  }
  console.log(`[secrets] Dropped privileges to ${target.uid}:${target.gid}`);
}

export function parseRunAs(value: string | undefined): { uid: number; gid: number } | null {
  const match = /^(\d+):(\d+)$/.exec(value ?? "");
  if (!match) return null;
  const uid = Number(match[1]);
  const gid = Number(match[2]);
  if (uid === 0 || gid === 0) return null;
  return { uid, gid };
}
