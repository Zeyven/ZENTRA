/** Provider-neutral model request and selection. No provider credential is handled here. */
export type ModelPreference = 'AUTO' | 'FAST' | 'BALANCED' | 'DEEP';
export type PrivacyLevel = 'STANDARD' | 'NO_TRAINING' | 'PRIVATE';

export type ModelDescriptor = Readonly<{
  provider: string;
  model: string;
  capabilities: readonly string[];
  regions: readonly string[];
  privacy: PrivacyLevel;
  contextTokens: number;
  qualityScore: number;
  latencyScore: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  available: boolean;
}>;

export type ModelRequest = Readonly<{
  preference: ModelPreference;
  requiredCapabilities: readonly string[];
  region: string;
  minPrivacy: PrivacyLevel;
  requiredContextTokens: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  maxEstimatedUsd: number;
}>;

export type ModelResponse = Readonly<{
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}>;

export interface ModelProvider {
  generate(
    request: Readonly<{ model: string; prompt: string; maxOutputTokens: number }>,
  ): Promise<ModelResponse>;
}

const privacyRank: Record<PrivacyLevel, number> = {
  STANDARD: 0,
  NO_TRAINING: 1,
  PRIVATE: 2,
};

function estimatedCost(model: ModelDescriptor, request: ModelRequest): number {
  return (
    (request.estimatedInputTokens * model.inputUsdPerMillion +
      request.estimatedOutputTokens * model.outputUsdPerMillion) /
    1_000_000
  );
}

/** Rejects unavailable, under-capable, wrong-region/privacy, or over-budget models before ranking. */
export function selectModel(
  request: ModelRequest,
  catalog: readonly ModelDescriptor[],
): ModelDescriptor {
  if (
    !Number.isFinite(request.maxEstimatedUsd) ||
    request.maxEstimatedUsd < 0 ||
    !Number.isSafeInteger(request.requiredContextTokens) ||
    request.requiredContextTokens < 0 ||
    !Number.isSafeInteger(request.estimatedInputTokens) ||
    request.estimatedInputTokens < 0 ||
    !Number.isSafeInteger(request.estimatedOutputTokens) ||
    request.estimatedOutputTokens < 0
  )
    throw new Error('INVALID_MODEL_REQUEST');

  const eligible = catalog.filter(
    (model) =>
      model.available &&
      model.regions.includes(request.region) &&
      privacyRank[model.privacy] >= privacyRank[request.minPrivacy] &&
      model.contextTokens >= request.requiredContextTokens &&
      request.requiredCapabilities.every((capability) => model.capabilities.includes(capability)) &&
      Number.isFinite(model.qualityScore) &&
      Number.isFinite(model.latencyScore) &&
      Number.isFinite(model.inputUsdPerMillion) &&
      Number.isFinite(model.outputUsdPerMillion) &&
      model.inputUsdPerMillion >= 0 &&
      model.outputUsdPerMillion >= 0 &&
      estimatedCost(model, request) <= request.maxEstimatedUsd,
  );
  if (!eligible.length) throw new Error('NO_ELIGIBLE_MODEL');

  const weight = {
    AUTO: { quality: 2, latency: 1, cost: 1 },
    FAST: { quality: 0.5, latency: 3, cost: 1 },
    BALANCED: { quality: 2, latency: 2, cost: 1 },
    DEEP: { quality: 3, latency: 0.5, cost: 0.5 },
  }[request.preference];
  return [...eligible].sort((a, b) => {
    const score = (model: ModelDescriptor) =>
      weight.quality * model.qualityScore +
      weight.latency * model.latencyScore -
      weight.cost * estimatedCost(model, request);
    return (
      score(b) - score(a) || `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`)
    );
  })[0]!;
}
