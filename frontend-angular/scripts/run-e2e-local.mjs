import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const repoRoot = 'c:/Innovacare validShift';
const frontendRoot = `${repoRoot}/frontend-angular`;
const functionsRoot = `${repoRoot}/backend-firebase-functions`;

function run(cmd, args, cwd, opts = {}) {
  const p = spawn(cmd, args, {
    cwd,
    shell: true,
    stdio: 'pipe',
    env: { ...process.env, ...(opts.env || {}) },
  });
  p.stdout.on('data', (d) => process.stdout.write(d));
  p.stderr.on('data', (d) => process.stderr.write(d));
  return p;
}

function onceOutput(proc, matcher, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for: ${matcher}`)), timeoutMs);
    const onData = (buf) => {
      const text = String(buf);
      if (text.includes(matcher)) {
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        proc.stderr.off('data', onData);
        resolve(undefined);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
  });
}

async function main() {
  const procs = [];
  try {
    const emulators = run('firebase', ['emulators:start', '--only', 'auth,functions,firestore'], repoRoot);
    procs.push(emulators);
    await onceOutput(emulators, 'All emulators ready');

    const seed = run('node', ['tools/seed-e2e.mjs'], functionsRoot);
    await new Promise((resolve, reject) => {
      seed.on('exit', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`seed failed: ${code}`))));
    });

    const ng = run('npm', ['run', 'start', '--', '--host', '127.0.0.1', '--port', '4200'], frontendRoot);
    procs.push(ng);
    await onceOutput(ng, 'Angular Live Development Server is listening');
    await wait(2000);

    const e2e = run('npm', ['run', 'e2e'], frontendRoot, {
      env: {
        E2E_BASE_URL: 'http://127.0.0.1:4200',
        E2E_ADMIN_EMAIL: 'e2e.admin@innovashift.local',
        E2E_EMP_EMAIL: 'e2e.staff@innovashift.local',
        E2E_PASSWORD: 'E2e!Pass1234',
      },
    });

    const exitCode = await new Promise((resolve) => e2e.on('exit', resolve));
    if (exitCode !== 0) throw new Error(`E2E failed with code ${exitCode}`);
  } finally {
    for (const p of procs.reverse()) {
      try { p.kill('SIGTERM'); } catch {}
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
