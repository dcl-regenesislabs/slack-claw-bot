// Environment for the children the server spawns itself (git, gh, qmd). Same rule as the
// agent's shell: no server secrets. Git is additionally told to ignore global/system config
// and hooks, because the memory clone and $HOME are agent-writable — a planted hook,
// `core.fsmonitor` or `~/.gitconfig` would otherwise run on the next boot pull or schedule
// commit with whatever this process holds.
// Shared with the agent shell allowlist in agent.ts so the two never resolve XDG/TMPDIR
// differently (qmd index dirs, gh config) between the server and the agent.
export const CHILD_ENV_BASE = [
  "PATH", "HOME", "USER", "SHELL", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TZ", "TERM",
  "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
];

// Injected through GIT_CONFIG_* so it also reaches the git that `gh repo clone` spawns.
// The empty credential.helper resets whatever the repo config lists before adding gh.
const GIT_CONFIG: Array<[string, string]> = [
  ["core.hooksPath", "/dev/null"],
  ["core.fsmonitor", "false"],
  ["credential.helper", ""],
  ["credential.helper", "!gh auth git-credential"],
];

/** Scrubbed environment plus the git hardening: for every server-side git, gh and qmd call. */
export function serverChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = scrubbedEnv(base);
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_CONFIG_COUNT = String(GIT_CONFIG.length);
  GIT_CONFIG.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

/** Scrubbed environment without the git overrides: only for `gh auth setup-git`, which must
 * write the credential helper into $HOME's .gitconfig for the agent's own git to use. */
export function userGitSetupEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return scrubbedEnv(base);
}

function scrubbedEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of CHILD_ENV_BASE) {
    if (base[name] !== undefined) env[name] = base[name];
  }
  for (const name of Object.keys(base)) {
    if (name.startsWith("QMD_")) env[name] = base[name];
  }
  if (base.GITHUB_TOKEN) env.GH_TOKEN = base.GITHUB_TOKEN;
  return env;
}
