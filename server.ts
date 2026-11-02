import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
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

interface DatabaseStructure {
  success: boolean;
  students: Student[];
  submissions: Submission[];
  stats: any;
  topPerformers: Student[];
  lastUpdated: string;
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

  // CORS headers
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Database API endpoints
  app.get('/api/database', (req: Request, res: Response) => {
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

  // Admin Authentication endpoint
  app.post('/api/admin/login', (req: Request, res: Response) => {
    const { adminId, password } = req.body;
    const cleanId = (adminId || '').toString().trim().toLowerCase();
    const validIds = ['admin', 'gmurugesh71@gmail.com', 'admin@aiexplorer.edu'];
    const validPasswords = ['Admin@SSMIET2026!', 'admin', 'ssmiet2026', 'admin@ssmiet2026'];

    if (validIds.includes(cleanId) && validPasswords.includes(password)) {
      return res.json({
        success: true,
        user: {
          uid: 'admin_ssmiet_2026',
          email: cleanId === 'admin' ? 'gmurugesh71@gmail.com' : cleanId,
          displayName: 'Administrator (SSMIET CSE)',
          role: 'admin',
          token: 'admin_session_' + Date.now()
        }
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Invalid credentials. Use Admin ID: admin and Password: Admin@SSMIET2026!'
    });
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
    const student = db.students.find(s => s.studentId === record.studentId);
    if (student) {
      student.lastActive = new Date().toISOString();
      if (record.school) student.school = record.school;
      if (record.district) student.district = record.district;
      if (record.classGrade) student.classGrade = record.classGrade;
      if (record.stream) student.stream = record.stream;

      if (record.type === 'knowledge_quiz') {
        student.quizScore = record.score;
        student.quizTotal = record.totalQuestions || 15;
        student.quizPercentage = record.percentage;
        student.timeSeconds = record.timeSeconds;
        student.badge = record.badge;
        student.totalScore = (student.promptScore || 5) + (record.score || 0);
        student.status = 'Completed Knowledge Quiz';
      } else if (record.type === 'career_profile') {
        if (Array.isArray(record.topMatches) && record.topMatches[0]) {
          student.careerTopMatch = record.topMatches[0].title;
          student.careerTopMatchPct = record.topMatches[0].percentage || record.topMatches[0].matchPct;
        }
        student.status = student.quizScore !== undefined ? 'Completed All Phases' : 'Completed Career Profile';
      }
    }

    recalculateStats(db);
    saveDatabase(db);
    res.json({ success: true, id: subId, stats: db.stats });
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
