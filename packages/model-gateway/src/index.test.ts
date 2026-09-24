import { describe, expect, it } from 'vitest';
import { selectModel, type ModelDescriptor, type ModelRequest } from './index';

const fast: ModelDescriptor = {
  provider: 'provider-a',
  model: 'fast',
  capabilities: ['text'],
  regions: ['us'],
  privacy: 'NO_TRAINING',
  contextTokens: 32_000,
  qualityScore: 6,
  latencyScore: 9,
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 2,
  available: true,
};
const deep: ModelDescriptor = {
  ...fast,
  provider: 'provider-b',
  model: 'deep',
  qualityScore: 9,
  latencyScore: 4,
  inputUsdPerMillion: 5,
  outputUsdPerMillion: 10,
};
const request: ModelRequest = {
  preference: 'AUTO',
  requiredCapabilities: ['text'],
  region: 'us',
  minPrivacy: 'NO_TRAINING',
  requiredContextTokens: 8_000,
  estimatedInputTokens: 5_000,
  estimatedOutputTokens: 1_000,
  maxEstimatedUsd: 1,
};

describe('model policy', () => {
  it('routes Fast and Deep preferences to different eligible models', () => {
    expect(selectModel({ ...request, preference: 'FAST' }, [fast, deep]).model).toBe('fast');
    expect(selectModel({ ...request, preference: 'DEEP' }, [fast, deep]).model).toBe('deep');
  });

  it('fails closed when region, privacy, capability, context, or cost disqualifies all models', () => {
    const restrictions: ModelRequest[] = [
      { ...request, region: 'eu' },
      { ...request, minPrivacy: 'PRIVATE' },
      { ...request, requiredCapabilities: ['vision'] },
      { ...request, requiredContextTokens: 64_000 },
      { ...request, maxEstimatedUsd: 0.001 },
    ];
    for (const restricted of restrictions)
      expect(() => selectModel(restricted, [fast, deep])).toThrow('NO_ELIGIBLE_MODEL');
  });

  it('rejects malformed budgets and never routes to unavailable models', () => {
    expect(() => selectModel({ ...request, maxEstimatedUsd: Number.NaN }, [fast])).toThrow(
      'INVALID_MODEL_REQUEST',
    );
    expect(() => selectModel(request, [{ ...fast, available: false }])).toThrow(
      'NO_ELIGIBLE_MODEL',
    );
  });
});
