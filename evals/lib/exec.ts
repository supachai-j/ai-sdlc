export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
}

/** Run a shell command with a hard timeout. Never throws on non-zero exit. */
export async function exec(
  cmd: string,
  opts: { cwd: string; timeoutSec?: number; env?: Record<string, string> },
): Promise<ExecResult> {
  const started = Date.now();
  const proc = Bun.spawn(["bash", "-lc", cmd], {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeoutMs = (opts.timeoutSec ?? 600) * 1000;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9);
  }, timeoutMs);

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { code, stdout, stderr, ms: Date.now() - started, timedOut };
}

/** Trim long command output down to something readable in a report. */
export function snip(s: string, max = 400): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max) + ` … (+${t.length - max} chars)`;
}
