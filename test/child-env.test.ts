import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serverChildEnv, userGitSetupEnv } from "../src/child-env.js";

describe("serverChildEnv", () => {
  it("forwards only the basics plus the GitHub token, never server secrets", () => {
    const env = serverChildEnv({
      PATH: "/bin", HOME: "/home/node", GITHUB_TOKEN: "ghp_x", QMD_INDEX_DIR: "/data/q",
      SLACK_BOT_TOKEN: "xoxb", ANTHROPIC_OAUTH_SETUP_TOKEN: "sk-ant-oat", DISCOURSE_API_KEY: "d",
    });
    assert.equal(env.PATH, "/bin");
    assert.equal(env.GH_TOKEN, "ghp_x");
    assert.equal(env.QMD_INDEX_DIR, "/data/q");
    for (const name of ["SLACK_BOT_TOKEN", "ANTHROPIC_OAUTH_SETUP_TOKEN", "DISCOURSE_API_KEY", "GITHUB_TOKEN"]) {
      assert.equal(name in env, false, name);
    }
  });

  it("disables hooks and user config and pins gh as the only credential helper", () => {
    const env = serverChildEnv({ PATH: "/bin" });
    assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
    assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
    const pairs = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]]);
    assert.deepEqual(pairs, [
      ["core.hooksPath", "/dev/null"],
      ["core.fsmonitor", "false"],
      ["credential.helper", ""],
      ["credential.helper", "!gh auth git-credential"],
    ]);
  });
});

describe("userGitSetupEnv", () => {
  it("is the same scrubbed shape but lets gh write the helper into $HOME's .gitconfig", () => {
    const env = userGitSetupEnv({ PATH: "/bin", HOME: "/home/node", GITHUB_TOKEN: "ghp_x", SLACK_BOT_TOKEN: "xoxb" });
    assert.equal(env.GH_TOKEN, "ghp_x");
    assert.equal("SLACK_BOT_TOKEN" in env, false);
    assert.equal("GIT_CONFIG_GLOBAL" in env, false);
    assert.equal("GIT_CONFIG_COUNT" in env, false);
  });
});
