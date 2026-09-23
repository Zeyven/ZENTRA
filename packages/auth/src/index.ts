import { verifyToken } from '@clerk/backend';

export { workspacePolicy } from './policy';
export type { PolicyAction, PolicyDecision, PolicyEngine, WorkspaceRole } from './policy';

/** Provider IDs remain in this adapter boundary and never enter Domain APIs. */
export interface VerifiedSession {
  readonly provider: 'clerk';
  readonly externalSubject: string;
  readonly sessionId: string;
}

export interface IdentityProvider {
  verifySession(token: string): Promise<VerifiedSession | null>;
}

export function createClerkIdentityProvider(options: {
  jwtKey: string;
  authorizedParties: readonly string[];
}): IdentityProvider {
  if (!options.jwtKey || options.authorizedParties.length === 0)
    throw new Error('Clerk verification requires a public JWT key and authorized parties');
  return {
    async verifySession(token) {
      if (!token) return null;
      try {
        const claims = await verifyToken(token, {
          jwtKey: options.jwtKey,
          authorizedParties: [...options.authorizedParties],
        });
        if (!claims.sub || !claims.sid) return null;
        return {
          provider: 'clerk',
          externalSubject: claims.sub,
          sessionId: claims.sid,
        };
      } catch {
        return null;
      }
    },
  };
}
