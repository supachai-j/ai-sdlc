import type { Arm, AgentStats } from "../types";

/** Fields we rely on from `claude -p --output-format json`. */
interface ClaudeResult {
  is_error?: boolean;
  stop_reason?: string;
  terminal_reason?: string;
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  permission_denials?: unknown[];
  subagent_stats?: { spawned?: number };
  session_id?: string;
  result?: string;
}

const DEFAULT_ALLOWED = ["Read", "Grep", "Glob", "Edit", "Write"];

export function buildArgs(arm: Arm, prompt: string): string[] {
  const args = ["-p", prompt, "--output-format", "json"];
  args.push("--permission-mode", arm.permission_mode ?? "acceptEdits");
  const tools = arm.allowed_tools ?? DEFAULT_ALLOWED;
  if (tools.length) args.push("--allowedTools", ...tools);
  if (arm.model) args.push("--model", arm.model);
  if (arm.append_system_prompt) args.push("--append-system-prompt", arm.append_system_prompt);
  if (arm.args?.length) args.push(...arm.args);
  return args;
}

/**
 * Run the agent once inside `cwd`. Returns normalised stats plus the raw payload,
 * which is kept on disk so a later question can be answered without a re-run.
 */
export async function runAgent(
  arm: Arm,
  prompt: string,
  cwd: string,
  timeoutSec: number,
): Promise<{ stats: AgentStats; raw: unknown; parseError?: string }> {
  const started = Date.now();
  const proc = Bun.spawn(["claude", ...buildArgs(arm, prompt)], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9);
  }, timeoutSec * 1000);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  clearTimeout(timer);

  const wall = Date.now() - started;
  const fallback: AgentStats = {
    is_error: true,
    terminal_reason: timedOut ? "harness_timeout" : "unparsable_output",
    num_turns: 0,
    cost_usd: 0,
    wall_ms: wall,
    api_ms: 0,
    permission_denials: 0,
    subagents_spawned: 0,
  };

  let parsed: ClaudeResult | undefined;
  try {
    parsed = JSON.parse(stdout.trim()) as ClaudeResult;
  } catch {
    return {
      stats: fallback,
      raw: { stdout_head: stdout.slice(0, 2000), stderr_head: stderr.slice(0, 2000) },
      parseError: timedOut ? `timed out after ${timeoutSec}s` : "could not parse JSON from claude",
    };
  }

  return {
    stats: {
      is_error: Boolean(parsed.is_error),
      stop_reason: parsed.stop_reason,
      terminal_reason: parsed.terminal_reason,
      num_turns: parsed.num_turns ?? 0,
      cost_usd: parsed.total_cost_usd ?? 0,
      wall_ms: parsed.duration_ms ?? wall,
      api_ms: parsed.duration_api_ms ?? 0,
      permission_denials: parsed.permission_denials?.length ?? 0,
      subagents_spawned: parsed.subagent_stats?.spawned ?? 0,
      session_id: parsed.session_id,
    },
    raw: parsed,
  };
}
