# ADR 0001 M0 implementation boundaries

Status: implementation record; no baseline change.

Authority: AYRA BASELINE v1.0, white paper §§0, 3, 20, Appendix B. Source extraction is retained locally; the source SHA-256 is published in `docs/baseline/`. The original Word file remains unchanged.

M0 introduces the specified pnpm packages and five independently buildable applications, with common TypeScript, lint, formatting, tests and CI conventions. Domain has no provider dependency. Browser/mobile exports contain no server secrets. API exposes only liveness, unavailable readiness and OpenAPI. Worker intentionally accepts no tasks until M3.

No identity bypass, local task executor, simulated business persistence, model call or external write is provided. All current provider packages except configuration/schema/UI are reserved boundaries, not completed adapters.

React is pinned to Expo SDK 57's bundled compatibility version 19.2.3. TypeScript 6.0.3 is within typescript-eslint's supported range; exact patches and the pnpm lockfile are implementation details, not a change of frozen stack.

OPEN items remain as listed in white paper §24.1. Production cloud, prices, models, retention and SLOs are not selected.

Rollback: revert M0 source changes. `pnpm infra:down` keeps volumes. Never delete local environment files or volumes automatically. M0 creates no business schema or external customer state.
