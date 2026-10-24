export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

const MAX_CAPTURE = 512 * 1024;
const HEAD_KEEP = 8 * 1024;

function truncate(text: string): string {
  if (text.length <= MAX_CAPTURE) return text;
  return `${text.slice(0, HEAD_KEEP)}\n...[truncated]...\n${text.slice(-(MAX_CAPTURE - HEAD_KEEP))}`;
}

export function tailLines(text: string, lines = 40): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n");
}

/** Run a command without a shell. Returns captured output; never throws on exit code. */
export async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const proc = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs && options.timeoutMs > 0) {
    timer = setTimeout(() => {
      proc.kill();
    }, options.timeoutMs);
  }

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout: truncate(stdout), stderr: truncate(stderr) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function failureDetail(result: CommandResult): string {
  const stderr = tailLines(result.stderr);
  if (stderr) return stderr;
  const stdout = tailLines(result.stdout);
  return stdout || `exit code ${result.code}`;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
