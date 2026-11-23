import { isAdminConfigured, sendJson } from '../_lib/admin-auth.js';

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed.' });
  }
  return sendJson(res, 200, {
    success: true,
    configured: isAdminConfigured(),
  });
}
