import { extractBearerToken, sendJson, verifySignedAdminToken } from '../_lib/admin-auth.js';

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed.' });
  }

  const token = extractBearerToken(req);
  if (!token) {
    return sendJson(res, 401, { success: false, error: 'Admin authentication required.' });
  }

  const session = verifySignedAdminToken(token);
  if (!session) {
    return sendJson(res, 401, {
      success: false,
      error: 'Admin session expired or invalid. Please sign in again.',
    });
  }

  return sendJson(res, 200, {
    success: true,
    user: {
      uid: `admin_${session.username}`,
      name: session.username,
      email: `${session.username}@admin.local`,
      displayName: session.displayName,
      role: 'admin',
    },
  });
}
