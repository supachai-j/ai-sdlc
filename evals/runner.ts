#!/usr/bin/env bun
/**
 * Runs every task × every arm × N repeats and writes one JSON record per run.
 *
 *   bun evals/runner.ts                     # all tasks, all arms, 3 repeats
 *   bun evals/runner.ts --repeats 5
 *   bun evals/runner.ts --tasks fix-a,fix-b --arms baseline
 *   bun evals/runner.ts --dry-run           # validate task files, run nothing
 */
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Arm, RunMeta, RunRecord, Task } from "./types";
import { exec } from "./lib/exec";
import { addWorktree, removeWorktree, collectDiff, resolveSha } from "./lib/git";
import { runAgent } from "./lib/agent";
import { beforeCommands, evaluate } from "./criteria";

const ROOT = resolve(import.meta.dir, "..");

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function expand(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : resolve(p);
}

async function readTasks(filter?: string[]): Promise<Task[]> {
  const dir = join(ROOT, "evals", "tasks");
  const out: Task[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".yaml") || f.startsWith("_")) continue;
    const raw = await Bun.file(join(dir, f)).text();
    const t = Bun.YAML.parse(raw) as Task;
    if (!t?.id) throw new Error(`${f}: missing "id"`);
    if (!t.repo) throw new Error(`${t.id}: missing "repo"`);
    if (!t.sha) throw new Error(`${t.id}: missing "sha" — a task without a pinned SHA is not reproducible`);
    if (!t.prompt) throw new Error(`${t.id}: missing "prompt"`);
    if (!t.criteria?.length) throw new Error(`${t.id}: no criteria — nothing to decide pass/fail with`);
    if (filter && !filter.includes(t.id)) continue;
    out.push(t);
  }
  return out;
}

async function readArms(filter?: string[]): Promise<Arm[]> {
  const raw = await Bun.file(join(ROOT, "evals", "arms.yaml")).text();
  const parsed = Bun.YAML.parse(raw) as { arms: Arm[] };
  const arms = parsed.arms ?? [];
  return filter ? arms.filter((a) => filter.includes(a.id)) : arms;
}

async function main() {
  const repeats = Number(arg("repeats", "3"));
  const taskFilter = arg("tasks")?.split(",").map((s) => s.trim());
  const armFilter = arg("arms")?.split(",").map((s) => s.trim());
  const agentTimeout = Number(arg("timeout", "900"));

  const tasks = await readTasks(taskFilter);
  const arms = await readArms(armFilter);
  if (!tasks.length) throw new Error("no tasks matched — add YAML files under evals/tasks/");
  if (!arms.length) throw new Error("no arms matched — check evals/arms.yaml");

  // Fail fast on unreachable repos or bad SHAs, before spending a cent.
  for (const t of tasks) {
    const repo = expand(t.repo);
    if (!existsSync(join(repo, ".git"))) throw new Error(`${t.id}: not a git repo → ${repo}`);
    const sha = await resolveSha(repo, t.sha);
    const check = await exec(`git cat-file -e ${JSON.stringify(sha)}^{commit}`, { cwd: repo, timeoutSec: 30 });
    if (check.code !== 0) throw new Error(`${t.id}: sha not found in ${repo} → ${t.sha}`);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(ROOT, "runs", runId);
  mkdirSync(outDir, { recursive: true });

  const version = (await exec("claude --version", { cwd: ROOT, timeoutSec: 30 })).stdout.trim();
  const meta: RunMeta = {
    run_id: runId,
    started_at: new Date().toISOString(),
    repeats,
    arms,
    tasks: tasks.map((t) => t.id),
    claude_version: version,
    host: hostname(),
  };
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));

  const total = tasks.length * arms.length * repeats;
  console.log(`run ${runId} · ${tasks.length} tasks × ${arms.length} arms × ${repeats} repeats = ${total} runs`);
  if (has("dry-run")) {
    console.log("dry run — task files and SHAs validated, nothing executed");
    return;
  }

  let n = 0;
  for (const task of tasks) {
    const repo = expand(task.repo);
    for (const armCfg of arms) {
      for (let repeat = 1; repeat <= repeats; repeat++) {
        n++;
        const tag = `[${n}/${total}] ${task.id} · ${armCfg.id} · #${repeat}`;
        const wt = join(tmpdir(), `eval-${runId}-${task.id}-${armCfg.id}-${repeat}`);
        const rec: RunRecord = {
          task: task.id,
          arm: armCfg.id,
          repeat,
          started_at: new Date().toISOString(),
          ok: false,
          criteria: [],
          agent: {
            is_error: true, num_turns: 0, cost_usd: 0, wall_ms: 0,
            api_ms: 0, permission_denials: 0, subagents_spawned: 0,
          },
          interventions: 0,
          diff: { files: [], added: 0, removed: 0 },
        };

        try {
          await addWorktree(repo, task.sha, wt);

          if (task.setup) {
            const s = await exec(task.setup, { cwd: wt, timeoutSec: task.setup_timeout_sec ?? 600 });
            if (s.code !== 0) throw new Error(`setup failed (exit ${s.code}): ${s.stderr.slice(0, 300)}`);
          }

          // Capture the "before" state so red→green criteria are decidable.
          const before: Record<string, number> = {};
          for (const b of beforeCommands(task.criteria)) {
            before[b.cmd] = (await exec(b.cmd, { cwd: wt, timeoutSec: b.timeoutSec })).code;
          }

          const { stats, raw, parseError } = await runAgent(armCfg, task.prompt, wt, agentTimeout);
          rec.agent = stats;
          if (parseError) rec.error = parseError;
          writeFileSync(join(outDir, `${task.id}__${armCfg.id}__${repeat}.raw.json`), JSON.stringify(raw, null, 2));

          rec.diff = await collectDiff(wt);
          rec.criteria = await evaluate(task.criteria, { dir: wt, diff: rec.diff, agent: stats, before });
          rec.ok = rec.criteria.length > 0 && rec.criteria.every((c) => c.pass);
          // Automatic proxy only — see README on what this can and cannot see.
          rec.interventions = stats.permission_denials + (stats.is_error ? 1 : 0);
        } catch (e) {
          rec.error = e instanceof Error ? e.message : String(e);
        } finally {
          await removeWorktree(repo, wt);
        }

        writeFileSync(join(outDir, `${task.id}__${armCfg.id}__${repeat}.json`), JSON.stringify(rec, null, 2));
        const mark = rec.ok ? "PASS" : "FAIL";
        console.log(
          `${tag} → ${mark} · $${rec.agent.cost_usd.toFixed(4)} · ${(rec.agent.wall_ms / 1000).toFixed(0)}s` +
            (rec.error ? ` · ${rec.error}` : ""),
        );
      }
    }
  }

  meta.finished_at = new Date().toISOString();
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(`\ndone → runs/${runId}\nreport:  bun evals/report.ts ${runId}`);
}

main().catch((e) => {
  console.error(`\nerror: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
