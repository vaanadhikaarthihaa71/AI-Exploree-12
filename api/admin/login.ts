import {
  checkLoginRateLimit,
  clearLoginAttempts,
  createSignedAdminSession,
  getClientIp,
  isAdminConfigured,
  parseJsonBody,
  recordFailedLogin,
  sendJson,
  verifyAdminCredentials,
} from '../_lib/admin-auth.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed.' });
  }

  const clientIp = getClientIp(req);
  if (!checkLoginRateLimit(clientIp)) {
    return sendJson(res, 429, {
      success: false,
      error: 'Too many failed sign-in attempts. Please wait a few minutes and try again.',
    });
  }

  const body = await parseJsonBody(req);
  const rawName =
    typeof body?.name === 'string'
      ? body.name
      : typeof body?.adminId === 'string'
        ? body.adminId
        : '';
  const rawPassword = typeof body?.password === 'string' ? body.password : '';

  if (
    rawName.trim().length === 0 ||
    rawName.length > 128 ||
    rawPassword.length === 0 ||
    rawPassword.length > 128
  ) {
    recordFailedLogin(clientIp);
    return sendJson(res, 401, {
      success: false,
      error: 'Invalid admin name or password.',
    });
  }

  if (!isAdminConfigured()) {
    return sendJson(res, 503, {
      success: false,
      error: 'Admin credentials are not configured yet.',
    });
  }

  const check = verifyAdminCredentials(rawName, rawPassword);
  if (check.valid) {
    clearLoginAttempts(clientIp);
    const { token, session } = createSignedAdminSession(check.username);
    return sendJson(res, 200, {
      success: true,
      token,
      user: {
        uid: `admin_${check.username}`,
        name: check.username,
        email: `${check.username}@admin.local`,
        displayName: session.displayName,
        role: 'admin',
      },
    });
  }

  recordFailedLogin(clientIp);
  return sendJson(res, 401, {
    success: false,
    error: 'Invalid admin name or password.',
  });
}
