#!/usr/bin/env bun
/**
 * Aggregates a run into the four dimensions, and compares two arms pairwise.
 *
 *   bun evals/report.ts                 # newest run
 *   bun evals/report.ts <run-id>
 *   bun evals/report.ts <run-id> --save # also write baselines/<run-id>.json
 *
 * Ranges are printed, not just means. If the ranges of two arms overlap,
 * you have not measured a difference — you have measured noise.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunMeta, RunRecord } from "./types";

const ROOT = resolve(import.meta.dir, "..");
const RUNS = join(ROOT, "runs");

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}
function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}
function padL(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(q * (s.length - 1)));
  return s[i]!;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

interface ArmSummary {
  arm: string;
  runs: number;
  passRate: number;
  /** Per-task pass rate spread across repeats — the honesty column. */
  perTaskLow: number;
  perTaskHigh: number;
  costMean: number;
  costTotal: number;
  wallP50: number;
  wallP95: number;
  interventions: number;
  errors: number;
}

function summarise(records: RunRecord[], arm: string, taskIds: string[]): ArmSummary {
  const rs = records.filter((r) => r.arm === arm);
  const perTask = taskIds.map((t) => {
    const tr = rs.filter((r) => r.task === t);
    return tr.length ? tr.filter((r) => r.ok).length / tr.length : 0;
  });
  const walls = rs.map((r) => r.agent.wall_ms / 1000);
  return {
    arm,
    runs: rs.length,
    passRate: rs.length ? rs.filter((r) => r.ok).length / rs.length : 0,
    perTaskLow: perTask.length ? Math.min(...perTask) : 0,
    perTaskHigh: perTask.length ? Math.max(...perTask) : 0,
    costMean: rs.length ? sum(rs.map((r) => r.agent.cost_usd)) / rs.length : 0,
    costTotal: sum(rs.map((r) => r.agent.cost_usd)),
    wallP50: quantile(walls, 0.5),
    wallP95: quantile(walls, 0.95),
    interventions: sum(rs.map((r) => r.interventions)),
    errors: rs.filter((r) => r.error).length,
  };
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const runId =
    args[0] ??
    readdirSync(RUNS)
      .filter((d) => existsSync(join(RUNS, d, "meta.json")))
      .sort()
      .pop();
  if (!runId) throw new Error("no runs found — run `bun evals/runner.ts` first");

  const dir = join(RUNS, runId);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as RunMeta;
  const records: RunRecord[] = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".raw.json") && f !== "meta.json")
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as RunRecord);

  const armIds = meta.arms.map((a) => a.id);
  const summaries = armIds.map((a) => summarise(records, a, meta.tasks));

  console.log(`\nrun ${runId}`);
  console.log(`${meta.claude_version} · ${meta.tasks.length} tasks · ${meta.repeats} repeats/task/arm\n`);

  const W = [22, 9, 15, 11, 11, 11, 8, 7];
  const head = ["arm", "pass", "per-task range", "$ / run", "wall p50", "wall p95", "interv.", "errors"];
  console.log(head.map((h, i) => (i === 0 ? pad(h, W[i]!) : padL(h, W[i]!))).join("  "));
  console.log(W.map((w) => "─".repeat(w)).join("  "));
  for (const s of summaries) {
    console.log(
      [
        pad(s.arm, W[0]!),
        padL(pct(s.passRate), W[1]!),
        padL(`${pct(s.perTaskLow)} – ${pct(s.perTaskHigh)}`, W[2]!),
        padL(`$${s.costMean.toFixed(4)}`, W[3]!),
        padL(`${s.wallP50.toFixed(0)}s`, W[4]!),
        padL(`${s.wallP95.toFixed(0)}s`, W[5]!),
        padL(String(s.interventions), W[6]!),
        padL(String(s.errors), W[7]!),
      ].join("  "),
    );
  }

  // Per-task detail — where the signal actually lives.
  console.log("\nper task");
  console.log(`${pad("task", 30)}  ${armIds.map((a) => padL(a.slice(0, 14), 15)).join("")}`);
  console.log("─".repeat(30 + armIds.length * 15));
  for (const t of meta.tasks) {
    const cells = armIds.map((a) => {
      const tr = records.filter((r) => r.task === t && r.arm === a);
      const passes = tr.filter((r) => r.ok).length;
      return padL(tr.length ? `${passes}/${tr.length}` : "–", 15);
    });
    console.log(`${pad(t, 30)}  ${cells.join("")}`);
  }

  // Paired comparison: which tasks changed, not just by how much overall.
  if (armIds.length === 2) {
    const [a, b] = armIds as [string, string];
    const rate = (t: string, arm: string) => {
      const tr = records.filter((r) => r.task === t && r.arm === arm);
      return tr.length ? tr.filter((r) => r.ok).length / tr.length : 0;
    };
    const gained = meta.tasks.filter((t) => rate(t, b) > rate(t, a));
    const lost = meta.tasks.filter((t) => rate(t, b) < rate(t, a));
    console.log(`\npaired: ${a} → ${b}`);
    console.log(`  improved  ${gained.length ? gained.join(", ") : "(none)"}`);
    console.log(`  regressed ${lost.length ? lost.join(", ") : "(none)"}`);
    const sa = summaries[0]!, sb = summaries[1]!;
    const overlap = !(sb.perTaskLow > sa.perTaskHigh || sa.perTaskLow > sb.perTaskHigh);
    console.log(
      overlap
        ? `  ⚠ per-task ranges overlap — with ${meta.tasks.length} tasks × ${meta.repeats} repeats this is not yet a measured difference`
        : `  ranges are disjoint — the difference survives this sample`,
    );
  }

  // Criteria that never discriminate carry no information.
  const byLabel = new Map<string, { pass: number; total: number }>();
  for (const r of records) {
    for (const c of r.criteria) {
      const e = byLabel.get(c.label) ?? { pass: 0, total: 0 };
      e.total++;
      if (c.pass) e.pass++;
      byLabel.set(c.label, e);
    }
  }
  const dead = [...byLabel.entries()].filter(([, v]) => v.total >= 3 && (v.pass === v.total || v.pass === 0));
  if (dead.length) {
    console.log("\ncriteria with no signal (always same verdict — retire or make harder)");
    for (const [l, v] of dead) console.log(`  ${v.pass === v.total ? "always pass" : "always fail"}  ${l}`);
  }

  console.log(`\ntotal spend  $${sum(summaries.map((s) => s.costTotal)).toFixed(4)}`);

  if (process.argv.includes("--save")) {
    const out = join(ROOT, "baselines", `${runId}.json`);
    writeFileSync(out, JSON.stringify({ meta, summaries }, null, 2));
    console.log(`baseline → baselines/${runId}.json`);
  }
}

try {
  main();
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
