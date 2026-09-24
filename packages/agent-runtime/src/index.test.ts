import { describe, expect, it } from 'vitest';
import { assertDelegatedCapabilities } from './index';

describe('Agent delegation', () => {
  const parent = [
    { capability: 'resource.read', resourceIds: ['project-a', 'project-b'] },
    { capability: 'artifact.write', resourceIds: ['project-a'] },
  ];

  it('permits a strict subset of parent authority', () => {
    expect(() =>
      assertDelegatedCapabilities(parent, [
        { capability: 'resource.read', resourceIds: ['project-b'] },
      ]),
    ).not.toThrow();
  });

  it('rejects a different action, resource, or unscoped capability', () => {
    for (const child of [
      [{ capability: 'artifact.write', resourceIds: ['project-b'] }],
      [{ capability: 'resource.delete', resourceIds: ['project-a'] }],
      [{ capability: 'resource.read', resourceIds: [] }],
    ]) {
      expect(() => assertDelegatedCapabilities(parent, child)).toThrow(
        'DELEGATED_CAPABILITY_EXCEEDS_PARENT',
      );
    }
  });
});
