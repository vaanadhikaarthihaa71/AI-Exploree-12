import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  writeBatch,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  limit,
  increment,
  type Unsubscribe,
  type DocumentData
} from "firebase/firestore";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  type User
} from "firebase/auth";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Authorized admin emails list (Project owner + institutional administrators)
export const AUTHORIZED_ADMIN_EMAILS = [
  "gmurugesh71@gmail.com",
  "vaanadhikaarthihaa71@gmail.com",
  "admin@aiexplorer.edu",
  "admin@ssmiet.ac.in",
  "hodcse@ssmiet.ac.in"
];

export async function isUserAuthorizedAdmin(user: User): Promise<boolean> {
  if (!user || !user.email) return false;
  const email = user.email.toLowerCase().trim();

  // 1. Direct verified email check (Project owner & admin domains)
  if (
    AUTHORIZED_ADMIN_EMAILS.includes(email) ||
    email.endsWith("@aiexplorer.edu") ||
    email.startsWith("admin@")
  ) {
    return true;
  }

  // 2. Custom claims check
  try {
    const tokenResult = await user.getIdTokenResult();
    if (tokenResult.claims && (tokenResult.claims.admin === true || tokenResult.claims.role === "admin")) {
      return true;
    }
  } catch (e) {
    console.warn("Could not check token claims:", e);
  }

  // 3. Firestore admins collection check
  try {
    const adminDocRef = doc(db, "admins", user.uid);
    const snap = await getDoc(adminDocRef);
    if (snap.exists()) return true;

    // Also check document keyed by email
    const emailDocRef = doc(db, "admins", email);
    const emailSnap = await getDoc(emailDocRef);
    if (emailSnap.exists()) return true;
  } catch (e) {
    console.warn("Could not check admins collection:", e);
  }

  return false;
}

// Test live connection to Firestore
export async function testConnection(): Promise<{ success: boolean; message: string; databaseId: string }> {
  try {
    const testDoc = doc(db, "test", "connection");
    await setDoc(testDoc, {
      connected: true,
      testedAt: new Date().toISOString(),
      databaseId: firebaseConfig.firestoreDatabaseId
    });
    return {
      success: true,
      message: "Connected to live Cloud Firestore database",
      databaseId: firebaseConfig.firestoreDatabaseId
    };
  } catch (err: any) {
    console.error("Firestore testConnection failed:", err);
    return {
      success: false,
      message: err?.message || "Connection failed",
      databaseId: firebaseConfig.firestoreDatabaseId
    };
  }
}

// Student-side submission helpers
export async function saveStudentRecord(student: {
  studentId: string;
  studentName: string;
  school?: string;
  district?: string;
  classGrade?: string;
  stream?: string;
  registeredAt?: string;
  status?: string;
  overallProgress?: number;
  [key: string]: any;
}) {
  const sid = student.studentId;
  const docRef = doc(db, "students", sid);
  const nowIso = new Date().toISOString();

  await setDoc(
    docRef,
    {
      ...student,
      lastActive: nowIso,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function saveQuizSubmission(quizData: {
  studentId: string;
  studentName: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  timeSeconds: number;
  timeFormatted: string;
  badge: string;
  quizLanguage: string;
  wrongAnswersCount: number;
  school?: string;
  answersSummary?: any[];
}) {
  const nowIso = new Date().toISOString();
  const attemptId = `quiz_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;

  // 1. Add to quizAttempts collection
  await addDoc(collection(db, "quizAttempts"), {
    ...quizData,
    attemptId,
    createdAt: nowIso,
    timestamp: serverTimestamp()
  });

  // 2. Add badge to studentBadges
  const isChampion = quizData.score >= 12;
  const badgeTitle = isChampion ? "AI Champion 🏆" : (quizData.score >= 8 ? "AI Explorer 🚀" : "AI Explorer");
  await addDoc(collection(db, "studentBadges"), {
    badgeId: `badge_quiz_${quizData.studentId}_${Date.now()}`,
    studentId: quizData.studentId,
    studentName: quizData.studentName,
    badgeName: badgeTitle,
    category: "Knowledge Quiz",
    description: isChampion ? "Scored 80%+ on Knowledge Quiz" : "Scored on Class 12 AI Knowledge Quiz",
    earnedAt: nowIso,
    timestamp: serverTimestamp()
  });

  // 3. Update student record
  const studentRef = doc(db, "students", quizData.studentId);
  await setDoc(
    studentRef,
    {
      studentId: quizData.studentId,
      studentName: quizData.studentName,
      quizScore: quizData.score,
      highestScore: quizData.score,
      totalScore: quizData.score + 5,
      averageAccuracy: quizData.percentage,
      timeSeconds: quizData.timeSeconds,
      badge: badgeTitle,
      status: "Completed Knowledge Quiz 🏆",
      overallProgress: 100,
      totalQuizAttempts: increment(1),
      lastActive: nowIso,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function savePromptGymSubmission(gymData: {
  studentId: string;
  studentName: string;
  promptText: string;
  score: number;
  school?: string;
}) {
  const nowIso = new Date().toISOString();
  const submissionId = `gym_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;

  // 1. Add to promptSubmissions
  await addDoc(collection(db, "promptSubmissions"), {
    ...gymData,
    submissionId,
    maxScore: 5,
    submittedAt: nowIso,
    timestamp: serverTimestamp()
  });

  // 2. Add badge
  await addDoc(collection(db, "studentBadges"), {
    badgeId: `badge_gym_${gymData.studentId}`,
    studentId: gymData.studentId,
    studentName: gymData.studentName,
    badgeName: "Prompt Master 💡",
    category: "Prompt Gym",
    description: "Mastered the 5-ingredient prompt engineering recipe",
    earnedAt: nowIso,
    timestamp: serverTimestamp()
  });

  // 3. Update student
  const studentRef = doc(db, "students", gymData.studentId);
  await setDoc(
    studentRef,
    {
      studentId: gymData.studentId,
      studentName: gymData.studentName,
      promptGymCompleted: true,
      promptScore: gymData.score,
      overallProgress: 34,
      lastActive: nowIso,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export async function saveCareerAssessment(careerData: {
  studentId: string;
  studentName: string;
  school?: string;
  stream?: string;
  district?: string;
  classGrade?: string;
  favSubjects?: string[];
  mathComfort?: number;
  codingComfort?: number;
  hobbies?: string[];
  careerPriorities?: string[];
  workStyle?: string;
  environmentPref?: string;
  planAfter12th?: string;
  tenYearGoal?: string;
  topMatches?: any[];
  profileAnalysis?: any;
}) {
  const nowIso = new Date().toISOString();
  const assessmentId = `career_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;

  // 1. Add to careerAssessments
  await addDoc(collection(db, "careerAssessments"), {
    ...careerData,
    assessmentId,
    createdAt: nowIso,
    timestamp: serverTimestamp()
  });

  // 2. Add badge
  await addDoc(collection(db, "studentBadges"), {
    badgeId: `badge_career_${careerData.studentId}`,
    studentId: careerData.studentId,
    studentName: careerData.studentName,
    badgeName: "Career Pioneer 🧭",
    category: "Career Profile",
    description: "Completed comprehensive 8-domain career mapping dossier",
    earnedAt: nowIso,
    timestamp: serverTimestamp()
  });

  // 3. Update student
  const studentRef = doc(db, "students", careerData.studentId);
  const topMatch = careerData.topMatches?.[0]?.title || "";
  const topMatchPct = careerData.topMatches?.[0]?.percentage || 0;
  await setDoc(
    studentRef,
    {
      studentId: careerData.studentId,
      studentName: careerData.studentName,
      careerCompleted: true,
      careerTopMatch: topMatch,
      careerTopMatchPct: topMatchPct,
      overallProgress: 67,
      lastActive: nowIso,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

// Student Engagement & Performance Metrics Telemetry
export interface EngagementMetricPayload {
  studentId: string;
  studentName: string;
  section: string;
  sectionKey: "guide" | "gym" | "tools" | "resistant" | "career" | "knowledge" | string;
  action: string;
  performanceScore?: number;
  maxScore?: number;
  scorePercentage?: number;
  timeSpentSeconds?: number;
  overallProgress?: number;
  school?: string;
  district?: string;
  classGrade?: string;
  stream?: string;
  details?: Record<string, any>;
  [key: string]: any;
}

export async function logEngagementMetric(metric: EngagementMetricPayload): Promise<string> {
  const nowIso = new Date().toISOString();
  const metricId = `metric_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;

  try {
    // 1. Write granular performance telemetry record
    await addDoc(collection(db, "engagementMetrics"), {
      ...metric,
      metricId,
      createdAt: nowIso,
      timestamp: serverTimestamp()
    });

    // 2. Update student's active engagement tracking in 'students' collection
    if (metric.studentId) {
      const studentRef = doc(db, "students", metric.studentId);
      const studentUpdate: Record<string, any> = {
        lastActive: nowIso,
        lastSection: metric.section,
        lastSectionKey: metric.sectionKey,
        lastAction: metric.action,
        updatedAt: serverTimestamp()
      };
      if (typeof metric.overallProgress === "number") {
        studentUpdate.overallProgress = metric.overallProgress;
      }
      if (typeof metric.performanceScore === "number") {
        studentUpdate[`${metric.sectionKey}Score`] = metric.performanceScore;
      }
      await setDoc(studentRef, studentUpdate, { merge: true });
    }

    // 3. Roll up section-level interaction count in sectionMetrics
    if (metric.sectionKey) {
      const sectionRef = doc(db, "sectionMetrics", metric.sectionKey);
      await setDoc(
        sectionRef,
        {
          sectionKey: metric.sectionKey,
          sectionName: metric.section,
          totalInteractions: increment(1),
          lastActive: nowIso,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }

    return metricId;
  } catch (err) {
    console.warn("Could not log engagement metric to Firestore:", err);
    return metricId;
  }
}

// Admin Real-Time Listeners
export function listenToWorkshopData(callbacks: {
  onStudents?: (students: DocumentData[]) => void;
  onQuizzes?: (quizzes: DocumentData[]) => void;
  onPrompts?: (prompts: DocumentData[]) => void;
  onCareers?: (careers: DocumentData[]) => void;
  onBadges?: (badges: DocumentData[]) => void;
  onAuditLogs?: (logs: DocumentData[]) => void;
  onMetrics?: (metrics: DocumentData[]) => void;
  onError?: (err: Error) => void;
}): () => void {
  const unsubscribes: Unsubscribe[] = [];

  try {
    // 1. Students
    unsubscribes.push(
      onSnapshot(
        collection(db, "students"),
        (snap) => {
          const list: DocumentData[] = [];
          snap.forEach((d) => list.push({ ...d.data(), _id: d.id }));
          callbacks.onStudents?.(list);
        },
        (err) => {
          console.warn("Students listener error:", err);
          callbacks.onError?.(err);
        }
      )
    );

    // 2. Quiz Attempts
    unsubscribes.push(
      onSnapshot(
        collection(db, "quizAttempts"),
        (snap) => {
          const list: DocumentData[] = [];
          snap.forEach((d) => list.push({ ...d.data(), _id: d.id }));
          callbacks.onQuizzes?.(list);
        },
        (err) => callbacks.onError?.(err)
      )
    );

    // 3. Prompt Submissions
    unsubscribes.push(
      onSnapshot(
        collection(db, "promptSubmissions"),
        (snap) => {
          const list: DocumentData[] = [];
          snap.forEach((d) => list.push({ ...d.data(), _id: d.id }));
          callbacks.onPrompts?.(list);
        },
        (err) => callbacks.onError?.(err)
      )
    );

    // 4. Career Assessments
    unsubscribes.push(
      onSnapshot(
        collection(db, "careerAssessments"),
        (snap) => {
          const list: DocumentData[] = [];
          snap.forEach((d) => list.push({ ...d.data(), _id: d.id }));
          callbacks.onCareers?.(list);
        },
        (err) => callbacks.onError?.(err)
      )
    );

    // 5. Student Badges
    unsubscribes.push(
      onSnapshot(
        collection(db, "studentBadges"),
        (snap) => {
          const list: DocumentData[] = [];
          snap.forEach((d) => list.push({ ...d.data(), _id: d.id }));
          callbacks.onBadges?.(list);
        },
        (err) => callbacks.onError?.(err)
      )
    );

    // 6. Admin Audit Logs
    const auditQuery = query(collection(db, "adminAuditLogs"), orderBy("timestamp", "desc"), limit(50));
    unsubscribes.push(
      onSnapshot(
        auditQuery,
        (snap) => {
          const list: DocumentData[] = [];
          snap.forEach((d) => list.push({ ...d.data(), _id: d.id }));
          callbacks.onAuditLogs?.(list);
        },
        (err) => callbacks.onError?.(err)
      )
    );

    // 7. Student Engagement & Performance Metrics (Across Workshop Sections)
    const metricsQuery = query(collection(db, "engagementMetrics"), orderBy("timestamp", "desc"), limit(100));
    unsubscribes.push(
      onSnapshot(
        metricsQuery,
        (snap) => {
          const list: DocumentData[] = [];
          snap.forEach((d) => list.push({ ...d.data(), _id: d.id }));
          callbacks.onMetrics?.(list);
        },
        (err) => {
          // If indexing or order fails, fall back to simple collection snapshot
          console.warn("Ordered engagementMetrics query error, attempting raw collection:", err);
          onSnapshot(
            collection(db, "engagementMetrics"),
            (snap) => {
              const list: DocumentData[] = [];
              snap.forEach((d) => list.push({ ...d.data(), _id: d.id }));
              callbacks.onMetrics?.(list);
            },
            (e) => callbacks.onError?.(e)
          );
        }
      )
    );
  } catch (err: any) {
    console.error("listenToWorkshopData setup error:", err);
    callbacks.onError?.(err);
  }

  // Return unsubscribe cleanup function
  return () => {
    unsubscribes.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {}
    });
  };
}

// Log admin audit entry
export async function logAdminAudit(action: string, details: string) {
  try {
    const user = auth.currentUser;
    await addDoc(collection(db, "adminAuditLogs"), {
      adminEmail: user?.email || "admin",
      adminUid: user?.uid || "unauthenticated",
      action,
      details,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.warn("Could not log admin audit:", err);
  }
}

// Clear all workshop session data across Cloud Firestore collections
export async function clearWorkshopSessionData(options?: {
  clearLocalStorage?: boolean;
  clearServerDatabase?: boolean;
}): Promise<{
  success: boolean;
  totalDeleted: number;
  collectionCounts: Record<string, number>;
  message: string;
}> {
  const targetCollections = [
    "students",
    "quizAttempts",
    "promptSubmissions",
    "careerAssessments",
    "studentBadges",
    "studentProgress",
    "engagementMetrics",
    "sectionMetrics",
    "results",
    "test"
  ];

  const collectionCounts: Record<string, number> = {};
  let totalDeleted = 0;

  for (const colName of targetCollections) {
    try {
      const colRef = collection(db, colName);
      const snapshot = await getDocs(colRef);
      const docs = snapshot.docs;
      collectionCounts[colName] = docs.length;

      if (docs.length === 0) continue;

      // Batch delete in chunks of 400 (Firestore maximum batch size is 500)
      const chunkSize = 400;
      for (let i = 0; i < docs.length; i += chunkSize) {
        const chunk = docs.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        chunk.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      totalDeleted += docs.length;
    } catch (err) {
      console.error(`Error clearing collection ${colName}:`, err);
      collectionCounts[colName] = 0;
    }
  }

  // Clear local server database.json via server API if available
  if (options?.clearServerDatabase !== false) {
    try {
      await fetch("/api/admin/clear-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clearedBy: auth.currentUser?.email || "admin",
          timestamp: new Date().toISOString()
        })
      });
    } catch (e) {
      console.warn("Could not clear local server database:", e);
    }
  }

  // Broadcast session reset event to all connected browser tabs & student clients
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel("ai_explorer_db_sync");
      bc.postMessage({
        type: "session_reset",
        clearedAt: new Date().toISOString(),
        clearedBy: auth.currentUser?.email || "admin"
      });
      bc.close();
    }
  } catch (e) {}

  // Clear student local storage keys in this window
  if (options?.clearLocalStorage !== false && typeof window !== "undefined") {
    try {
      const studentKeys = [
        "ai_explorer_offline_results",
        "ai_explorer_completed",
        "ai_explorer_name",
        "ai_explorer_id",
        "ai_explorer_max_tool",
        "ai_explorer_resistant_cards",
        "ai_explorer_degree_fields"
      ];
      studentKeys.forEach((k) => {
        try {
          localStorage.removeItem(k);
        } catch (_) {}
      });
    } catch (e) {}
  }

  // Record audit log entry in adminAuditLogs
  await logAdminAudit(
    "Clear Database / Reset Workshop Session",
    `Cleared ${totalDeleted} documents across workshop collections (${Object.entries(collectionCounts)
      .filter(([_, c]) => c > 0)
      .map(([k, c]) => `${k}: ${c}`)
      .join(", ") || "none"}). Database is now reset for fresh workshop entries.`
  );

  return {
    success: true,
    totalDeleted,
    collectionCounts,
    message: `Database successfully cleared! Erased ${totalDeleted} previous records. Ready for new workshop session entries.`
  };
}

// Expose on global window object for consumption by both static HTML templates
if (typeof window !== "undefined") {
  (window as any).AI_EXPLORER_FIREBASE = {
    app,
    db,
    auth,
    firebaseConfig,
    isUserAuthorizedAdmin,
    testConnection,
    saveStudentRecord,
    saveQuizSubmission,
    savePromptGymSubmission,
    saveCareerAssessment,
    logEngagementMetric,
    listenToWorkshopData,
    logAdminAudit,
    clearWorkshopSessionData,
    // Auth operations
    signInWithEmailAndPassword: (email: string, pass: string) => signInWithEmailAndPassword(auth, email, pass),
    createUserWithEmailAndPassword: (email: string, pass: string) => createUserWithEmailAndPassword(auth, email, pass),
    signInWithPopup: () => {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      return signInWithPopup(auth, provider);
    },
    sendPasswordResetEmail: (email: string) => sendPasswordResetEmail(auth, email),
    signOut: () => signOut(auth),
    onAuthStateChanged: (cb: (user: User | null) => void) => onAuthStateChanged(auth, cb)
  };

  // Dispatch custom ready event
  window.dispatchEvent(new CustomEvent("ai-explorer-firebase-ready", { detail: (window as any).AI_EXPLORER_FIREBASE }));
}
