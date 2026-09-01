import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { commitAdminChanges, inspectAdminGit } from "../scripts/lib/admin-git.mjs";

const exec = promisify(execFile);

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "cctv-admin-git-"));
  await exec("git", ["init", "-b", "main"], { cwd });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd });
  await exec("git", ["config", "user.name", "Test"], { cwd });
  await mkdir(join(cwd, "docs/data"), { recursive: true });
  await writeFile(join(cwd, "docs/data/cameras.json"), "{}\n");
  await writeFile(join(cwd, "README.md"), "base\n");
  await exec("git", ["add", "."], { cwd });
  await exec("git", ["commit", "-m", "base"], { cwd });
  return cwd;
}

test("admin Git commit stages only the camera allowlist", async () => {
  const cwd = await fixture();
  try {
    await writeFile(join(cwd, "docs/data/cameras.json"), "{\"changed\":true}\n");
    await commitAdminChanges({ cwd, message: "audit camera", confirmed: true });
    assert.match(await readFile(join(cwd, "docs/data/cameras.json"), "utf8"), /changed/);
    const log = await exec("git", ["log", "-1", "--pretty=%s"], { cwd });
    assert.equal(log.stdout.trim(), "audit camera");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("admin Git commit refuses unrelated tracked changes", async () => {
  const cwd = await fixture();
  try {
    await writeFile(join(cwd, "docs/data/cameras.json"), "{\"changed\":true}\n");
    await writeFile(join(cwd, "README.md"), "unrelated\n");
    const state = await inspectAdminGit({ cwd });
    assert.deepEqual(state.outsideAllowlist.map((item) => item.path), ["README.md"]);
    await assert.rejects(
      commitAdminChanges({ cwd, message: "unsafe", confirmed: true }),
      /outside admin allowlist/,
    );
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
