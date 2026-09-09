import { spawn } from 'node:child_process';
import process from 'node:process';

// The single common child-process delegate for every delegated route.
// The argv vector is passed to spawn without a shell so spaces, Unicode,
// shell metacharacters, `--` separators and flags keep exact boundaries.
// cwd/env are preserved, stdio is inherited untouched (no banners on stdout),
// and the child's normal exit code passes through. Diagnostics go to stderr.
export async function delegateChild({ label, file, args = [], useNode = true, extraEnv = {} }) {
  const command = useNode ? process.execPath : file;
  const spawnArgs = useNode ? [file, ...args] : [...args];
  const child = spawn(command, spawnArgs, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });

  return new Promise((resolveExitCode) => {
    // Narrow forwarding: only the direct child gets the signal, never the
    // whole process group, so pre-existing background gateway semantics are
    // untouched and no orphan-worker claims apply.
    const onSigint = () => {
      try {
        child.kill('SIGINT');
      } catch {
        // The child already exited; its exit handler settles the promise.
      }
    };
    const onSigterm = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // The child already exited; its exit handler settles the promise.
      }
    };
    const cleanup = () => {
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    child.on('error', (error) => {
      cleanup();
      console.error(`Failed to start ${label}: ${error.message}`);
      resolveExitCode(1);
    });
    child.on('exit', (code, signal) => {
      cleanup();
      if (signal) {
        console.error(`${label} exited after signal ${signal}`);
        resolveExitCode(1);
        return;
      }
      resolveExitCode(code ?? 1);
    });
  });
}
