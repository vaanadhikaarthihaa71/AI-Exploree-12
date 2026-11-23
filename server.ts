import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.resolve(__dirname, 'data', 'database.json');

interface Student {
  studentId: string;
  studentName: string;
  registeredAt: string;
  lastActive?: string;
  school?: string;
  district?: string;
  classGrade?: string;
  stream?: string;
  status?: string;
  quizScore?: number;
  quizTotal?: number;
  quizPercentage?: number;
  timeSeconds?: number;
  badge?: string;
  promptScore?: number;
  totalScore?: number;
  rank?: number;
  isTopPerformer?: boolean;
  careerTopMatch?: string;
  careerTopMatchPct?: number;
}

interface Submission {
  id?: string;
  type: string;
  studentId: string;
  studentName: string;
  createdAt: string;
  [key: string]: any;
}

interface AdminAuthRecord {
  username: string;
  salt: string;
  passwordHash: string;
  updatedAt: string;
}

interface AdminSession {
  username: string;
  displayName: string;
  createdAt: number;
  expiresAt: number;
}

interface DatabaseStructure {
  success: boolean;
  students: Student[];
  submissions: Submission[];
  stats: any;
  topPerformers: Student[];
  lastUpdated: string;
  adminAuth?: AdminAuthRecord;
}

// Server-side in-memory admin sessions & login rate-limit tracker
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 10;

const adminSessions = new Map<string, AdminSession>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function timingSafeStringMatch(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function hashAdminPassword(password: string, saltHex?: string): { salt: string; passwordHash: string } {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, passwordHash: derived };
}

function verifyScryptPassword(password: string, salt: string, storedHashHex: string): boolean {
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(storedHashHex, 'hex');
    if (derived.length !== stored.length) return false;
    return crypto.timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

function isAdminConfigured(db?: DatabaseStructure): boolean {
  const envUser = (process.env.ADMIN_USERNAME || '').trim();
  const envPass = process.env.ADMIN_PASSWORD || '';
  if (envUser.length > 0 && envPass.length > 0) return true;
  const currentDb = db || loadDatabase();
  return Boolean(currentDb.adminAuth?.username && currentDb.adminAuth?.salt && currentDb.adminAuth?.passwordHash);
}

function verifyAdminCredentials(nameInput: string, passwordInput: string): { valid: boolean; username: string } {
  const normalizedInput = nameInput.trim().toLowerCase();
  const envUser = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const envPass = process.env.ADMIN_PASSWORD || '';

  // Environment variables always take highest precedence when configured
  if (envUser.length > 0 && envPass.length > 0) {
    const userOk = timingSafeStringMatch(normalizedInput, envUser);
    const passOk = timingSafeStringMatch(passwordInput, envPass);
    return { valid: userOk && passOk, username: envUser };
  }

  const db = loadDatabase();
  const authRecord = db.adminAuth;
  if (!authRecord || !authRecord.username || !authRecord.salt || !authRecord.passwordHash) {
    return { valid: false, username: '' };
  }

  const storedUser = authRecord.username.trim().toLowerCase();
  const userOk = timingSafeStringMatch(normalizedInput, storedUser);
  const passOk = verifyScryptPassword(passwordInput, authRecord.salt, authRecord.passwordHash);
  return { valid: userOk && passOk, username: storedUser };
}

function createAdminSession(username: string): { token: string; session: AdminSession } {
  const now = Date.now();
  // Prune expired sessions opportunistically
  for (const [k, s] of adminSessions.entries()) {
    if (s.expiresAt <= now) adminSessions.delete(k);
  }
  const token = crypto.randomBytes(32).toString('hex');
  const session: AdminSession = {
    username,
    displayName: `Admin (${username})`,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS
  };
  adminSessions.set(token, session);
  return { token, session };
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+([A-Za-z0-9._-]+)$/);
  return match ? match[1] : null;
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Admin authentication required.' });
  }
  const session = adminSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) adminSessions.delete(token);
    return res.status(401).json({ success: false, error: 'Admin session expired or invalid. Please sign in again.' });
  }
  (req as any).adminSession = session;
  (req as any).adminToken = token;
  next();
}

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    return true;
  }
  return entry.count < MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

function loadDatabase(): DatabaseStructure {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading database:', err);
  }
  return {
    success: true,
    students: [],
    submissions: [],
    stats: {
      totalStudents: 0,
      totalSubmissions: 0,
      careerCount: 0,
      quizCount: 0,
      avgQuizScore: 0,
      avgQuizPct: 0,
      topDomain: 'None',
      topDomainCount: 0,
      topPerformer: null
    },
    topPerformers: [],
    lastUpdated: new Date().toISOString()
  };
}

function saveDatabase(db: DatabaseStructure) {
  try {
    db.lastUpdated = new Date().toISOString();
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

function recalculateStats(db: DatabaseStructure) {
  const students = db.students || [];
  const submissions = db.submissions || [];

  const quizzes = submissions.filter(s => s.type === 'knowledge_quiz' && typeof s.score === 'number');
  const careers = submissions.filter(s => s.type === 'career_profile');

  const sumScore = quizzes.reduce((acc, q) => acc + (q.score || 0), 0);
  const avgScore = quizzes.length > 0 ? parseFloat((sumScore / quizzes.length).toFixed(1)) : 0;
  const avgPct = quizzes.length > 0 ? Math.round((sumScore / (quizzes.length * 15)) * 100) : 0;

  // Domain tally
  const domainCounts: Record<string, number> = {};
  careers.forEach(c => {
    if (Array.isArray(c.topMatches) && c.topMatches[0]) {
      const title = c.topMatches[0].title || c.topMatches[0].id;
      domainCounts[title] = (domainCounts[title] || 0) + 1;
    }
  });

  const sortedDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
  const topDomain = sortedDomains.length > 0 ? sortedDomains[0][0] : 'None';
  const topDomainCount = sortedDomains.length > 0 ? sortedDomains[0][1] : 0;

  // Top performers
  const scoredStudents = [...students].sort((a, b) => {
    const scoreA = a.totalScore ?? a.quizScore ?? 0;
    const scoreB = b.totalScore ?? b.quizScore ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (a.timeSeconds || 9999) - (b.timeSeconds || 9999);
  });

  scoredStudents.forEach((st, idx) => {
    st.rank = idx + 1;
    st.isTopPerformer = idx === 0 && (st.quizScore ?? 0) > 0;
  });

  const topPerformer = scoredStudents.length > 0 && (scoredStudents[0].quizScore ?? 0) > 0 ? scoredStudents[0] : null;

  db.stats = {
    totalStudents: students.length,
    totalSubmissions: submissions.length,
    careerCount: careers.length,
    quizCount: quizzes.length,
    avgQuizScore: avgScore,
    avgQuizPct: avgPct,
    topDomain: topDomain,
    topDomainCount: topDomainCount,
    topPerformer: topPerformer
  };

  db.topPerformers = scoredStudents.slice(0, 5);
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Security response headers (no wildcard CORS on API routes)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // Admin Auth Status (indicates whether credentials are configured)
  app.get('/api/admin/auth-status', (req: Request, res: Response) => {
    res.json({
      success: true,
      configured: isAdminConfigured()
    });
  });

  // One-time bootstrap route if neither env vars nor persisted hash exist yet
  app.post('/api/admin/setup', (req: Request, res: Response) => {
    const db = loadDatabase();
    if (isAdminConfigured(db)) {
      return res.status(403).json({
        success: false,
        error: 'Admin credentials are already configured.'
      });
    }

    const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    if (rawName.length < 2 || rawName.length > 64 || rawPassword.length < 4 || rawPassword.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid admin name and password.'
      });
    }

    const normalizedName = rawName.toLowerCase();
    const { salt, passwordHash } = hashAdminPassword(rawPassword);
    db.adminAuth = {
      username: normalizedName,
      salt,
      passwordHash,
      updatedAt: new Date().toISOString()
    };
    saveDatabase(db);

    const { token, session } = createAdminSession(normalizedName);
    return res.json({
      success: true,
      token,
      user: {
        uid: `admin_${normalizedName}`,
        name: normalizedName,
        email: `${normalizedName}@admin.local`,
        displayName: session.displayName,
        role: 'admin'
      }
    });
  });

  // Protected Database API endpoint (Admin only)
  app.get('/api/database', requireAdminAuth, (req: Request, res: Response) => {
    const db = loadDatabase();
    res.json({
      success: true,
      students: db.students || [],
      submissions: db.submissions || [],
      stats: db.stats || {},
      topPerformers: db.topPerformers || [],
      lastUpdated: db.lastUpdated
    });
  });

  // Admin Authentication endpoint (server-verified scrypt / env credentials)
  app.post('/api/admin/login', (req: Request, res: Response) => {
    const clientIp = getClientIp(req);
    if (!checkLoginRateLimit(clientIp)) {
      return res.status(429).json({
        success: false,
        error: 'Too many failed sign-in attempts. Please wait a few minutes and try again.'
      });
    }

    const rawName = typeof req.body?.name === 'string'
      ? req.body.name
      : typeof req.body?.adminId === 'string'
        ? req.body.adminId
        : '';
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';

    if (
      rawName.trim().length === 0 ||
      rawName.length > 128 ||
      rawPassword.length === 0 ||
      rawPassword.length > 128
    ) {
      recordFailedLogin(clientIp);
      return res.status(401).json({
        success: false,
        error: 'Invalid admin name or password.'
      });
    }

    if (!isAdminConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Admin credentials are not configured yet. Complete initial setup first.'
      });
    }

    const check = verifyAdminCredentials(rawName, rawPassword);
    if (check.valid) {
      clearLoginAttempts(clientIp);
      const { token, session } = createAdminSession(check.username);
      return res.json({
        success: true,
        token,
        user: {
          uid: `admin_${check.username}`,
          name: check.username,
          email: `${check.username}@admin.local`,
          displayName: session.displayName,
          role: 'admin'
        }
      });
    }

    recordFailedLogin(clientIp);
    return res.status(401).json({
      success: false,
      error: 'Invalid admin name or password.'
    });
  });

  // Verify current admin session
  app.get('/api/admin/me', requireAdminAuth, (req: Request, res: Response) => {
    const session: AdminSession = (req as any).adminSession;
    res.json({
      success: true,
      user: {
        uid: `admin_${session.username}`,
        name: session.username,
        email: `${session.username}@admin.local`,
        displayName: session.displayName,
        role: 'admin'
      }
    });
  });

  // Revoke admin session
  app.post('/api/admin/logout', (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (token) {
      adminSessions.delete(token);
    }
    res.json({ success: true });
  });

  app.post('/api/students', (req: Request, res: Response) => {
    const { studentName, studentId, registeredAt } = req.body;
    if (!studentName) {
      return res.status(400).json({ error: 'Student name is required' });
    }

    const db = loadDatabase();
    const id = studentId || `EXP-${Math.floor(1000 + Math.random() * 9000)}`;

    let existing = db.students.find(s => s.studentId === id);
    if (!existing) {
      existing = {
        studentId: id,
        studentName: studentName.trim(),
        registeredAt: registeredAt || new Date().toISOString(),
        lastActive: new Date().toISOString(),
        status: 'Joined Workshop ⚡'
      };
      db.students.push(existing);
    } else {
      existing.studentName = studentName.trim();
      existing.lastActive = new Date().toISOString();
    }

    recalculateStats(db);
    saveDatabase(db);
    res.json({ success: true, student: existing });
  });

  app.post('/api/submissions', (req: Request, res: Response) => {
    const record = req.body;
    if (!record || !record.type) {
      return res.status(400).json({ error: 'Valid submission record required' });
    }

    const db = loadDatabase();
    const subId = record.id || `sub_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;
    const fullRecord: Submission = {
      ...record,
      id: subId,
      createdAt: record.createdAt || new Date().toISOString()
    };

    // Filter out duplicate if already exists with same ID
    db.submissions = db.submissions.filter(s => s.id !== subId);
    db.submissions.unshift(fullRecord);

    // Update student's corresponding record
    const student: any = db.students.find(s => s.studentId === record.studentId);
    if (student) {
      student.lastActive = new Date().toISOString();
      student.guideCompleted = true;
      if (record.studentName) student.studentName = record.studentName;
      if (record.school) student.school = record.school;
      if (record.district) student.district = record.district;
      if (record.classGrade) student.classGrade = record.classGrade;
      if (record.stream) student.stream = record.stream;

      if (record.type === 'prompt_gym') {
        student.promptGymCompleted = true;
        student.promptScore = Math.max(student.promptScore || 0, record.promptScore || 5);
        student.status = student.knowledgeQuizCompleted ? student.status : 'Completed Prompt Gym 💬';
      } else if (record.type === 'tools_completed') {
        student.aiToolsCompleted = true;
        student.aiToolsCount = record.toolsCount || 7;
        student.status = student.knowledgeQuizCompleted ? student.status : 'Completed AI Tools 🛠️';
      } else if (record.type === 'resistant_completed') {
        student.aiResistantCompleted = true;
        student.aiResistantCount = record.fieldsCount || 5;
        student.status = student.knowledgeQuizCompleted ? student.status : 'Completed AI-Resistant Fields 🛡️';
      } else if (record.type === 'career_profile') {
        student.careerCompleted = true;
        if (Array.isArray(record.topMatches) && record.topMatches[0]) {
          student.careerTopMatch = record.topMatches[0].title;
          student.careerTopMatchPct = record.topMatches[0].percentage || record.topMatches[0].matchPct;
          student.careerTopMatches = record.topMatches.slice(0, 3).map((m: any) => ({
            title: m.title,
            percentage: m.percentage || m.matchPct || 0
          }));
        }
        student.careerDetails = {
          school: record.school || '',
          district: record.district || '',
          classGrade: record.classGrade || '12th',
          stream: record.stream || '',
          mathComfort: record.mathComfort ?? 3,
          codingComfort: record.codingComfort ?? 1,
          planAfter12th: record.planAfter12th || '',
          tenYearGoal: record.tenYearGoal || '',
          topMatches: student.careerTopMatches || []
        };
        student.status = student.knowledgeQuizCompleted ? 'Completed All Phases' : 'Completed Career Profile 🎯';
      } else if (record.type === 'knowledge_quiz') {
        student.knowledgeQuizCompleted = true;
        student.quizScore = typeof student.quizScore === 'number' ? Math.max(student.quizScore, record.score || 0) : (record.score || 0);
        student.quizTotal = record.totalQuestions || 15;
        student.quizPercentage = record.percentage;
        student.timeSeconds = record.timeSeconds;
        student.timeFormatted = record.timeFormatted;
        student.badge = record.badge;
        student.totalScore = (student.promptScore || 0) + (student.quizScore || 0);
        student.status = 'Completed Knowledge Quiz 🏆';
      }

      const doneStages = [
        student.guideCompleted !== false,
        !!student.promptGymCompleted,
        !!student.aiToolsCompleted,
        !!student.aiResistantCompleted,
        !!student.careerCompleted,
        !!student.knowledgeQuizCompleted
      ].filter(Boolean).length;
      student.overallProgress = Math.round((doneStages / 6) * 100);
    }

    recalculateStats(db);
    saveDatabase(db);
    res.json({ success: true, id: subId, stats: db.stats });
  });

  // Admin session reset & clear database (requires verified admin Bearer session)
  app.post('/api/admin/clear-database', requireAdminAuth, (req: Request, res: Response) => {
    const session: AdminSession = (req as any).adminSession;
    const existingDb = loadDatabase();
    const freshDb: DatabaseStructure = {
      success: true,
      students: [],
      submissions: [],
      stats: {
        totalStudents: 0,
        totalSubmissions: 0,
        careerCount: 0,
        quizCount: 0,
        avgQuizScore: 0,
        avgQuizPct: 0,
        topDomain: 'None',
        topDomainCount: 0,
        topPerformer: null
      },
      topPerformers: [],
      lastUpdated: new Date().toISOString(),
      ...(existingDb.adminAuth ? { adminAuth: existingDb.adminAuth } : {})
    };
    saveDatabase(freshDb);
    console.log(`[Admin] Database cleared by ${session.username} at ${new Date().toISOString()}`);
    res.json({
      success: true,
      message: 'Database reset successfully. Ready for new workshop entries.',
      timestamp: new Date().toISOString()
    });
  });

  // Route /admin and /admin.html to admin portal
  app.get(['/admin', '/admin.html'], (req: Request, res: Response) => {
    const target = isProd ? path.resolve(__dirname, 'dist', 'admin.html') : path.resolve(__dirname, 'admin.html');
    res.sendFile(target);
  });

  // Vite integration
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: process.env.DISABLE_HMR === 'true' ? null : {}
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));

    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server active on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
