import { extractBearerToken, revokeAdminToken, sendJson } from '../_lib/admin-auth.js';

export default function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed.' });
  }

  const token = extractBearerToken(req);
  if (token) {
    revokeAdminToken(token);
  }

  return sendJson(res, 200, { success: true });
}
