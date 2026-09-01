import { exec } from "./exec";

/**
 * A worktree is the isolation boundary: every run starts from the pinned SHA
 * in a throwaway directory, so runs cannot contaminate each other.
 */
export async function addWorktree(repo: string, sha: string, dir: string): Promise<void> {
  const r = await exec(`git worktree add --detach ${JSON.stringify(dir)} ${JSON.stringify(sha)}`, {
    cwd: repo,
    timeoutSec: 120,
  });
  if (r.code !== 0) throw new Error(`worktree add failed: ${r.stderr.trim() || r.stdout.trim()}`);
}

export async function removeWorktree(repo: string, dir: string): Promise<void> {
  await exec(`git worktree remove --force ${JSON.stringify(dir)}`, { cwd: repo, timeoutSec: 120 });
}

/**
 * What the agent actually changed, including files it created.
 * `add -A -N` registers new files as intent-to-add so they show up in the diff.
 */
export async function collectDiff(
  dir: string,
): Promise<{ files: string[]; added: number; removed: number }> {
  await exec("git add -A -N", { cwd: dir, timeoutSec: 60 });
  const r = await exec("git diff --numstat HEAD", { cwd: dir, timeoutSec: 60 });
  const files: string[] = [];
  let added = 0;
  let removed = 0;
  for (const line of r.stdout.split("\n")) {
    const m = line.trim().match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    if (m[1] !== "-") added += Number(m[1]);
    if (m[2] !== "-") removed += Number(m[2]);
    files.push(m[3]);
  }
  return { files, added, removed };
}

export async function resolveSha(repo: string, rev: string): Promise<string> {
  const r = await exec(`git rev-parse ${JSON.stringify(rev)}`, { cwd: repo, timeoutSec: 30 });
  return r.code === 0 ? r.stdout.trim() : rev;
}
