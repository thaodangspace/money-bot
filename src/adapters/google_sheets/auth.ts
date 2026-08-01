import { elapsedMs, errorFields, type Logger, nullLogger } from '../../shared/logger.ts';

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export class ServiceAccountTokenProvider {
  #credentials: ServiceAccountCredentials;
  #fetcher: typeof fetch;
  #cached?: CachedToken;
  #logger: Logger;

  constructor(
    credentials: ServiceAccountCredentials,
    fetcher: typeof fetch = fetch,
    logger: Logger = nullLogger,
  ) {
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error('service-account credentials are incomplete');
    }
    this.#credentials = credentials;
    this.#fetcher = fetcher;
    this.#logger = logger;
  }

  async accessToken(signal: AbortSignal): Promise<string> {
    const now = Date.now();
    if (this.#cached && this.#cached.expiresAt - 60_000 > now) return this.#cached.accessToken;

    const issuedAt = Math.floor(now / 1_000);
    const assertion = await signJWT({
      iss: this.#credentials.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: this.#credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: issuedAt,
      exp: issuedAt + 3_600,
    }, this.#credentials.private_key);
    const tokenURL = this.#credentials.token_uri ?? 'https://oauth2.googleapis.com/token';
    const started = performance.now();
    const logger = this.#logger.forSignal(signal);
    logger.debug('external.call.start', {
      from: 'ServiceAccountTokenProvider',
      to: 'Google OAuth token endpoint',
    });
    let response: Response;
    try {
      response = await this.#fetcher(tokenURL, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });
    } catch (error) {
      logger.error('external.call.failed', {
        from: 'ServiceAccountTokenProvider',
        to: 'Google OAuth token endpoint',
        durationMs: elapsedMs(started),
        ...errorFields(error),
      });
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Google OAuth HTTP status ${response.status}`);
      logger.error('external.call.failed', {
        from: 'ServiceAccountTokenProvider',
        to: 'Google OAuth token endpoint',
        durationMs: elapsedMs(started),
        status: response.status,
        ...errorFields(error),
      });
      throw error;
    }
    const data = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
      const error = new Error('Google OAuth response was invalid');
      logger.error('external.call.failed', {
        from: 'ServiceAccountTokenProvider',
        to: 'Google OAuth token endpoint',
        durationMs: elapsedMs(started),
        ...errorFields(error),
      });
      throw error;
    }
    this.#cached = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1_000,
    };
    logger.debug('external.call.success', {
      from: 'ServiceAccountTokenProvider',
      to: 'Google OAuth token endpoint',
      durationMs: elapsedMs(started),
      status: response.status,
    });
    return data.access_token;
  }
}

export function parseServiceAccountCredentials(json: string): ServiceAccountCredentials {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Google credentials JSON is invalid');
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Google credentials JSON is invalid');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.client_email !== 'string' || typeof record.private_key !== 'string') {
    throw new Error('Google credentials JSON is missing service-account fields');
  }
  return {
    client_email: record.client_email,
    private_key: record.private_key,
    token_uri: typeof record.token_uri === 'string' ? record.token_uri : undefined,
  };
}

async function signJWT(
  payload: Record<string, string | number>,
  privateKeyPEM: string,
): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const encodedPayload = base64url(JSON.stringify(payload));
  const keyData = pemToBytes(privateKeyPEM);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData.buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${encodedPayload}`),
  );
  return `${header}.${encodedPayload}.${base64url(new Uint8Array(signature))}`;
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/u, '').replace(
    /-----END PRIVATE KEY-----/u,
    '',
  ).replace(/\s+/gu, '');
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64url(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
