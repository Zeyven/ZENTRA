import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createClerkIdentityProvider } from './index';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwtKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
function token(claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const message = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url');
  return `${message}.${signature}`;
}
const now = Math.floor(Date.now() / 1000);
const claims = {
  sub: 'provider-user-1',
  sid: 'provider-session-1',
  iss: 'https://test.clerk.accounts.dev',
  azp: 'http://localhost:3000',
  iat: now,
  nbf: now - 5,
  exp: now + 300,
};

describe('Clerk identity adapter', () => {
  it('accepts a signed session token and returns only adapter identity', async () => {
    const provider = createClerkIdentityProvider({
      jwtKey,
      authorizedParties: ['http://localhost:3000'],
    });
    expect(await provider.verifySession(token(claims))).toEqual({
      provider: 'clerk',
      externalSubject: 'provider-user-1',
      sessionId: 'provider-session-1',
    });
  });
  it('rejects invalid signatures, wrong parties and tokens without a session', async () => {
    const provider = createClerkIdentityProvider({
      jwtKey,
      authorizedParties: ['http://localhost:3000'],
    });
    const valid = token(claims);
    expect(await provider.verifySession(`${valid.slice(0, -2)}xx`)).toBeNull();
    expect(
      await provider.verifySession(token({ ...claims, azp: 'https://elsewhere.example' })),
    ).toBeNull();
    expect(await provider.verifySession(token({ ...claims, sid: undefined }))).toBeNull();
    expect(await provider.verifySession(token({ ...claims, exp: now - 30 }))).toBeNull();
  });
});
