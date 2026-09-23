import { describe, expect, it } from 'vitest';
// @ts-expect-error JavaScript tooling module deliberately runs directly under Node.
import { domainViolations, importsOf, clientForbidden } from './boundaries.mjs';
describe('dependency boundary detector', () => {
  it('finds SDK leaks through type imports, re-exports, require, and dynamic import', () => {
    const source = `import type { Agent } from '@openai/agents'; export { X } from '@clerk/backend'; const a = require('e2b'); const b = import('@temporalio/workflow');`;
    expect(domainViolations(source)).toEqual([
      '@openai/agents',
      '@clerk/backend',
      'e2b',
      '@temporalio/workflow',
    ]);
  });
  it('permits local types and rejects computed imports', () => {
    expect(domainViolations(`import type { X } from './types'; import(name);`)).toEqual([
      '<dynamic-import>',
    ]);
  });
  it('rejects relative escapes out of the domain source boundary', () => {
    expect(domainViolations(`import { config } from '../../config/src';`)).toEqual([
      '../../config/src',
    ]);
  });
  it('does not mistake comments for imports', () => {
    expect(importsOf(`// import OpenAI from 'openai';`)).toEqual([]);
  });
  it('blocks privileged dependencies in client code', () => {
    for (const name of [
      '@ayra/config',
      '@ayra/tool-gateway',
      '@aws-sdk/client-s3',
      '@clerk/backend',
      'node:child_process',
    ])
      expect(clientForbidden.test(name)).toBe(true);
    expect(clientForbidden.test('@ayra/ui')).toBe(false);
  });
});
