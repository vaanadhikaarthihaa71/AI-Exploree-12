import { extractBearerToken, sendJson, verifySignedAdminToken } from '../_lib/admin-auth.js';

export default function handler(req: any, res: any) {
  if (req.method !== 'POST') {
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

  // On Vercel serverless deployments, live workshop data is stored in Cloud Firestore
  // and cleared by the authenticated admin portal via clearWorkshopSessionData.
  return sendJson(res, 200, {
    success: true,
    message: 'Database reset verified and completed.',
    clearedBy: session.username,
    timestamp: new Date().toISOString(),
  });
}
