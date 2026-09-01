import type { Criterion, CriterionResult, AgentStats } from "./types";
import { exec, snip } from "./lib/exec";

export interface CriteriaContext {
  dir: string;
  diff: { files: string[]; added: number; removed: number };
  agent: AgentStats;
  /** Exit codes from the `before` phase, keyed by command. */
  before: Record<string, number>;
}

function label(c: Criterion, fallback: string): string {
  return c.label ?? fallback;
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => new Bun.Glob(p).match(path));
}

/** Commands that must be run before the agent, so before/after can be compared. */
export function beforeCommands(criteria: Criterion[]): { cmd: string; timeoutSec: number }[] {
  return criteria
    .filter((c): c is Extract<Criterion, { type: "before_after" }> => c.type === "before_after")
    .map((c) => ({ cmd: c.cmd, timeoutSec: c.timeout_sec ?? 300 }));
}

export async function evaluate(
  criteria: Criterion[],
  ctx: CriteriaContext,
): Promise<CriterionResult[]> {
  const out: CriterionResult[] = [];

  for (const c of criteria) {
    if (c.type === "cmd") {
      const want = c.expect_exit ?? 0;
      const r = await exec(c.cmd, { cwd: ctx.dir, timeoutSec: c.timeout_sec ?? 300 });
      out.push({
        label: label(c, c.cmd),
        type: c.type,
        pass: r.code === want,
        detail:
          r.code === want
            ? `exit ${r.code}`
            : `exit ${r.code}, want ${want}${r.timedOut ? " (timed out)" : ""} · ${snip(r.stderr || r.stdout)}`,
      });
      continue;
    }

    if (c.type === "before_after") {
      const beforeCode = ctx.before[c.cmd];
      const after = await exec(c.cmd, { cwd: ctx.dir, timeoutSec: c.timeout_sec ?? 300 });
      // The strongest cheap signal there is: red before, green after.
      const failedBefore = beforeCode !== undefined && beforeCode !== 0;
      const passesAfter = after.code === 0;
      out.push({
        label: label(c, `red→green: ${c.cmd}`),
        type: c.type,
        pass: failedBefore && passesAfter,
        detail: !failedBefore
          ? `criterion is void — command already passed before the agent ran (exit ${beforeCode}); pick a real failing test`
          : passesAfter
            ? "failed before, passes after"
            : `still failing after (exit ${after.code}) · ${snip(after.stderr || after.stdout)}`,
      });
      continue;
    }

    if (c.type === "diff") {
      const problems: string[] = [];
      if (c.allow?.length) {
        const stray = ctx.diff.files.filter((f) => !matchesAny(f, c.allow!));
        if (stray.length) problems.push(`touched outside allow list: ${stray.slice(0, 5).join(", ")}`);
      }
      if (c.deny?.length) {
        const hit = ctx.diff.files.filter((f) => matchesAny(f, c.deny!));
        if (hit.length) problems.push(`touched denied paths: ${hit.slice(0, 5).join(", ")}`);
      }
      const total = ctx.diff.added + ctx.diff.removed;
      if (c.max_lines !== undefined && total > c.max_lines) {
        problems.push(`diff ${total} lines > max ${c.max_lines}`);
      }
      out.push({
        label: label(c, "diff scope"),
        type: c.type,
        pass: problems.length === 0,
        detail: problems.length
          ? problems.join(" · ")
          : `${ctx.diff.files.length} files, +${ctx.diff.added}/-${ctx.diff.removed}`,
      });
      continue;
    }

    if (c.type === "budget") {
      const problems: string[] = [];
      if (c.max_usd !== undefined && ctx.agent.cost_usd > c.max_usd) {
        problems.push(`$${ctx.agent.cost_usd.toFixed(4)} > $${c.max_usd}`);
      }
      const wallSec = ctx.agent.wall_ms / 1000;
      if (c.max_wall_sec !== undefined && wallSec > c.max_wall_sec) {
        problems.push(`${wallSec.toFixed(0)}s > ${c.max_wall_sec}s`);
      }
      if (c.max_turns !== undefined && ctx.agent.num_turns > c.max_turns) {
        problems.push(`${ctx.agent.num_turns} turns > ${c.max_turns}`);
      }
      out.push({
        label: label(c, "budget"),
        type: c.type,
        pass: problems.length === 0,
        detail: problems.length
          ? problems.join(" · ")
          : `$${ctx.agent.cost_usd.toFixed(4)} · ${wallSec.toFixed(0)}s · ${ctx.agent.num_turns} turns`,
      });
    }
  }

  return out;
}
