// Task / criteria / run-record shapes for the eval harness.
// One task = a frozen repo state + a prompt + criteria that a script can decide.

export type Criterion =
  /** Run a command in the worktree AFTER the agent. Pass when exit code matches. */
  | { type: "cmd"; cmd: string; expect_exit?: number; timeout_sec?: number; label?: string }
  /** Run the same command BEFORE and AFTER. Pass only when it fails first and passes after. */
  | { type: "before_after"; cmd: string; timeout_sec?: number; label?: string }
  /** Constrain what the agent was allowed to touch. Closes the "edit the test" loophole. */
  | { type: "diff"; allow?: string[]; deny?: string[]; max_lines?: number; label?: string }
  /** Ceilings on spend. A correct answer that costs $8 is not a pass. */
  | { type: "budget"; max_usd?: number; max_wall_sec?: number; max_turns?: number; label?: string };

export interface Task {
  id: string;
  /** Absolute or ~-relative path to the repo under test. */
  repo: string;
  /** Commit the worktree is pinned to. Without this, results cannot be compared over time. */
  sha: string;
  prompt: string;
  tags?: string[];
  /** Runs once in the fresh worktree before the agent starts (e.g. "bun install"). */
  setup?: string;
  setup_timeout_sec?: number;
  criteria: Criterion[];
}

export interface Arm {
  id: string;
  model?: string;
  permission_mode?: string;
  allowed_tools?: string[];
  append_system_prompt?: string;
  /** Raw extra flags passed straight to the claude CLI. */
  args?: string[];
}

export interface CriterionResult {
  label: string;
  type: string;
  pass: boolean;
  detail: string;
}

export interface AgentStats {
  is_error: boolean;
  stop_reason?: string;
  terminal_reason?: string;
  num_turns: number;
  cost_usd: number;
  wall_ms: number;
  api_ms: number;
  permission_denials: number;
  subagents_spawned: number;
  session_id?: string;
}

export interface RunRecord {
  task: string;
  arm: string;
  repeat: number;
  started_at: string;
  /** True only when every criterion passed. */
  ok: boolean;
  criteria: CriterionResult[];
  agent: AgentStats;
  /** Automatic proxy for "how often a human would have had to step in". */
  interventions: number;
  diff: { files: string[]; added: number; removed: number };
  error?: string;
}

export interface RunMeta {
  run_id: string;
  started_at: string;
  finished_at?: string;
  repeats: number;
  arms: Arm[];
  tasks: string[];
  claude_version: string;
  host: string;
}
