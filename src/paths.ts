import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The one persistent, bot-writable directory on a deployed host (`/data` in the image).
 * Unset — local dev, the CLI — and state goes where it always did: the OS temp dir. */
export function dataDir(): string | null {
  return process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : null;
}

/** `{DATA_DIR|tmpdir}/{name}`, created, with symlinks resolved (macOS `/var` → `/private/var`)
 * so qmd and the path guards see one stable spelling. */
export function stateDir(name: string): string {
  const base = dataDir() ?? tmpdir();
  const dir = join(base, name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}
