import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { importsOf, domainViolations, clientForbidden } from './boundaries.mjs';
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? ['node_modules', 'dist', '.next', '.expo', 'target'].includes(item.name)
        ? []
        : files(join(directory, item.name))
      : [join(directory, item.name)],
  );
}
const errors = [];
for (const file of files('packages/domain/src').filter((f) => /\.tsx?$/.test(f))) {
  const blocked = domainViolations(readFileSync(file, 'utf8'), dirname(file));
  if (blocked.length) errors.push(`${file}: domain imports ${blocked.join(', ')}`);
}
const domain = JSON.parse(readFileSync('packages/domain/package.json', 'utf8'));
if (
  Object.keys({
    ...domain.dependencies,
    ...domain.peerDependencies,
    ...domain.optionalDependencies,
  }).length
)
  errors.push('Domain may not declare runtime dependencies');
for (const folder of [
  'apps/web/src',
  'apps/desktop/src',
  'apps/mobile/src',
  'packages/ui/src',
  'packages/api-client/src',
  'packages/design-tokens/src',
]) {
  for (const file of files(folder).filter((f) => /\.tsx?$/.test(f))) {
    const source = readFileSync(file, 'utf8');
    if (importsOf(source, file).some((value) => clientForbidden.test(value)))
      errors.push(`${file}: privileged client import`);
    if (
      /process\.env\.(?:OPENAI_API_KEY|E2B_API_KEY|CLERK_SECRET_KEY|REVENUECAT_SECRET_KEY|DATABASE_URL|KMS_KEY_ID)/.test(
        source,
      )
    )
      errors.push(`${file}: server environment in client surface`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.info('PASS: M0 domain dependency and client/server source boundaries');
