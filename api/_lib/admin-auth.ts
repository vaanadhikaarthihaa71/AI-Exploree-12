import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AdminAuthRecord {
  username: string;
  salt: string;
  passwordHash: string;
  updatedAt: string;
}

export interface AdminSession {
  username: string;
  displayName: string;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 10;

const revokedTokenIds = new Map<string, number>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function resolveDatabasePath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'data', 'database.json'),
    path.resolve(__dirname, '..', '..', 'data', 'database.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

export function loadAdminAuthFromDb(): AdminAuthRecord | null {
  try {
    const dbPath = resolveDatabasePath();
    if (!fs.existsSync(dbPath)) return null;
    const raw = fs.readFileSync(dbPath, 'utf8');
    const parsed = JSON.parse(raw);
    const rec = parsed?.adminAuth;
    if (rec && typeof rec.username === 'string' && typeof rec.salt === 'string' && typeof rec.passwordHash === 'string') {
      return rec;
    }
  } catch (err) {
    console.error('Error reading adminAuth from database.json:', err);
  }
  return null;
}

export function timingSafeStringMatch(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function hashAdminPassword(password: string, saltHex?: string): { salt: string; passwordHash: string } {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, passwordHash: derived };
}

export function verifyScryptPassword(password: string, salt: string, storedHashHex: string): boolean {
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(storedHashHex, 'hex');
    if (derived.length !== stored.length) return false;
    return crypto.timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

export function isAdminConfigured(authRecordOverride?: AdminAuthRecord | null): boolean {
  const envUser = (process.env.ADMIN_USERNAME || '').trim();
  const envPass = process.env.ADMIN_PASSWORD || '';
  if (envUser.length > 0 && envPass.length > 0) return true;
  const rec = authRecordOverride !== undefined ? authRecordOverride : loadAdminAuthFromDb();
  return Boolean(rec?.username && rec?.salt && rec?.passwordHash);
}

export function verifyAdminCredentials(
  nameInput: string,
  passwordInput: string,
  authRecordOverride?: AdminAuthRecord | null
): { valid: boolean; username: string } {
  const normalizedInput = nameInput.trim().toLowerCase();
  const envUser = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const envPass = process.env.ADMIN_PASSWORD || '';

  // Environment variables always take highest precedence when configured
  if (envUser.length > 0 && envPass.length > 0) {
    const userOk = timingSafeStringMatch(normalizedInput, envUser);
    const passOk = timingSafeStringMatch(passwordInput, envPass);
    return { valid: userOk && passOk, username: envUser };
  }

  const authRecord = authRecordOverride !== undefined ? authRecordOverride : loadAdminAuthFromDb();
  if (!authRecord || !authRecord.username || !authRecord.salt || !authRecord.passwordHash) {
    return { valid: false, username: '' };
  }

  const storedUser = authRecord.username.trim().toLowerCase();
  const userOk = timingSafeStringMatch(normalizedInput, storedUser);
  const passOk = verifyScryptPassword(passwordInput, authRecord.salt, authRecord.passwordHash);
  return { valid: userOk && passOk, username: storedUser };
}

function getSigningKey(): Buffer | null {
  const explicitSecret = process.env.ADMIN_SESSION_SECRET || '';
  if (explicitSecret.length >= 16) {
    return crypto.createHash('sha256').update(explicitSecret, 'utf8').digest();
  }
  const envPass = process.env.ADMIN_PASSWORD || '';
  if (envPass.length > 0) {
    return crypto.createHmac('sha256', 'ai-explorer-admin-session-v1').update(envPass, 'utf8').digest();
  }
  const rec = loadAdminAuthFromDb();
  if (rec?.passwordHash && rec?.salt) {
    return crypto
      .createHmac('sha256', 'ai-explorer-admin-session-v1')
      .update(`${rec.salt}:${rec.passwordHash}`, 'utf8')
      .digest();
  }
  return null;
}

export function createSignedAdminSession(username: string): { token: string; session: AdminSession } {
  const key = getSigningKey();
  if (!key) {
    throw new Error('Admin signing key unavailable');
  }

  const now = Date.now();
  const jti = crypto.randomBytes(16).toString('hex');
  const payload = {
    sub: username,
    jti,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(payloadB64).digest('base64url');
  const token = `${payloadB64}.${sig}`;

  return {
    token,
    session: {
      username,
      displayName: `Admin (${username})`,
      createdAt: now,
      expiresAt: payload.exp,
    },
  };
}

export function verifySignedAdminToken(token: string): AdminSession | null {
  const key = getSigningKey();
  if (!key) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  try {
    const expectedSig = crypto.createHmac('sha256', key).update(payloadB64).digest();
    const providedSig = Buffer.from(sigB64, 'base64url');
    if (expectedSig.length !== providedSig.length || !crypto.timingSafeEqual(expectedSig, providedSig)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded.sub !== 'string' || typeof decoded.exp !== 'number' || typeof decoded.jti !== 'string') {
      return null;
    }

    const now = Date.now();
    if (decoded.exp <= now) return null;
    if (revokedTokenIds.has(decoded.jti)) return null;

    return {
      username: decoded.sub,
      displayName: `Admin (${decoded.sub})`,
      createdAt: typeof decoded.iat === 'number' ? decoded.iat : now,
      expiresAt: decoded.exp,
    };
  } catch {
    return null;
  }
}

export function revokeAdminToken(token: string): void {
  const parts = token.split('.');
  if (parts.length !== 2) return;
  try {
    const decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (decoded && typeof decoded.jti === 'string' && typeof decoded.exp === 'number') {
      const now = Date.now();
      for (const [k, exp] of revokedTokenIds.entries()) {
        if (exp <= now) revokedTokenIds.delete(k);
      }
      revokedTokenIds.set(decoded.jti, decoded.exp);
    }
  } catch {
    // ignore malformed token on logout
  }
}

export function extractBearerToken(req: any): string | null {
  const header = req?.headers?.authorization || req?.headers?.Authorization;
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
  return match ? match[1] : null;
}

export function getClientIp(req: any): string {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req?.socket?.remoteAddress || 'unknown';
}

export function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) return true;
  return entry.count < MAX_LOGIN_ATTEMPTS;
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

export function setSecurityHeaders(res: any): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
}

export function sendJson(res: any, statusCode: number, data: unknown): void {
  setSecurityHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export async function parseJsonBody(req: any): Promise<Record<string, any>> {
  if (req?.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req?.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer | string) => {
      raw += chunk.toString();
      if (raw.length > 1024 * 64) {
        raw = '';
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}
