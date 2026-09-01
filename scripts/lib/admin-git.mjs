import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const ADMIN_GIT_ALLOWLIST = Object.freeze(["docs/data/cameras.json"]);

export async function runGit(args, { cwd, runner = execFileAsync } = {}) {
  const result = await runner("git", args, { cwd, encoding: "utf8", maxBuffer: 10_000_000 });
  return String(result.stdout ?? "").trimEnd();
}

export function parseTrackedStatus(output) {
  return String(output).split("\n").filter(Boolean).map((line) => ({
    code: line.slice(0, 2),
    path: line.slice(3).trim(),
  }));
}

export async function inspectAdminGit({ cwd, runner } = {}) {
  const [branch, status, diff] = await Promise.all([
    runGit(["branch", "--show-current"], { cwd, runner }),
    runGit(["status", "--porcelain", "--untracked-files=no"], { cwd, runner }),
    runGit(["diff", "--", ...ADMIN_GIT_ALLOWLIST], { cwd, runner }),
  ]);
  const trackedChanges = parseTrackedStatus(status);
  const outsideAllowlist = trackedChanges.filter(({ path }) => !ADMIN_GIT_ALLOWLIST.includes(path));
  return { branch, diff, trackedChanges, outsideAllowlist };
}

export async function commitAdminChanges({ cwd, message, confirmed, runner } = {}) {
  if (!confirmed) throw new Error("Commit requires explicit confirmation");
  if (!message?.trim()) throw new Error("Commit message is required");
  const state = await inspectAdminGit({ cwd, runner });
  if (!state.branch) throw new Error("Cannot commit from detached HEAD");
  if (state.outsideAllowlist.length > 0) {
    throw new Error(`Tracked changes outside admin allowlist: ${state.outsideAllowlist.map((item) => item.path).join(", ")}`);
  }
  if (!state.diff) throw new Error("No camera changes to commit");
  await runGit(["add", "--", ...ADMIN_GIT_ALLOWLIST], { cwd, runner });
  await runGit(["commit", "-m", message.trim(), "--", ...ADMIN_GIT_ALLOWLIST], { cwd, runner });
  return inspectAdminGit({ cwd, runner });
}

export async function pushCurrentBranch({ cwd, confirmed, runner } = {}) {
  if (!confirmed) throw new Error("Push requires explicit confirmation");
  const state = await inspectAdminGit({ cwd, runner });
  if (!state.branch) throw new Error("Cannot push detached HEAD");
  if (state.trackedChanges.length > 0) throw new Error("Commit or discard tracked changes before push");
  await runGit(["push", "origin", state.branch], { cwd, runner });
  return { branch: state.branch };
}
