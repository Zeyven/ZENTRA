import { spawn, spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
const pm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
for (const script of ['env:init', 'infra:up', 'infra:verify', 'migrate']) {
  const result = spawnSync(pm, [script], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
loadEnvFile('.env.local');
const children = ['api', 'worker', 'web'].map((app) =>
  spawn(pm, ['--filter', `@ayra/${app}`, 'dev'], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code ?? 1));
}
