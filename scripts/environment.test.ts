import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
const script = resolve('scripts/env-init.mjs');
it('generates unique local credentials without logging them', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ayra-env-test-'));
  try {
    copyFileSync('.env.example', join(folder, '.env.example'));
    const output = execFileSync(process.execPath, [script], { cwd: folder, encoding: 'utf8' });
    const contents = readFileSync(join(folder, '.env.local'), 'utf8');
    const password = contents.match(/^APPLICATION_DB_PASSWORD=(.+)$/m)?.[1];
    expect(password).toMatch(/^[a-f0-9]{64}$/);
    expect(contents).toContain(`postgresql://application_role:${password}@127.0.0.1:5432/ayra`);
    expect(output).not.toContain(password);
    if (process.platform !== 'win32')
      expect(statSync(join(folder, '.env.local')).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
it('preserves an existing environment exactly', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ayra-env-preserve-'));
  try {
    const existing = 'PRESERVE_THIS=user-owned\n';
    writeFileSync(join(folder, '.env.local'), existing);
    execFileSync(process.execPath, [script], { cwd: folder });
    expect(readFileSync(join(folder, '.env.local'), 'utf8')).toBe(existing);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
