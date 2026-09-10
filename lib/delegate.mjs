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
    child.on('close', (code, signal) => {
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

// Capture delegate: same argv/cwd/env contract as delegateChild but with
// piped stdout/stderr, a bounded timeout, and a structured result. Silent by
// design so callers like `doctor --json` keep stdout pure JSON.
export async function delegateCapture({ label, file, args = [], useNode = true, extraEnv = {}, timeoutMs = 15000 }) {
  const command = useNode ? process.execPath : file;
  const spawnArgs = useNode ? [file, ...args] : [...args];
  const child = spawn(command, spawnArgs, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  if (child.stdout) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
  }
  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let spawnErrorMessage = null;
    let timeoutId = null;
    let killFallbackId = null;
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
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (killFallbackId !== null) {
        clearTimeout(killFallbackId);
        killFallbackId = null;
      }
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    };
    const settle = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    timeoutId = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // Already exited; close settles below.
      }
      killFallbackId = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already exited; close settles below.
        }
      }, 1000);
    }, timeoutMs);

    child.on('error', (error) => {
      spawnErrorMessage = error && error.message ? error.message : String(error);
      settle({ status: null, signal: null, stdout, stderr, timedOut, spawnErrorMessage });
    });
    child.on('close', (code, signal) => {
      settle({
        status: code ?? null,
        signal: signal ?? null,
        stdout,
        stderr,
        timedOut,
        spawnErrorMessage,
      });
    });
  });
}
