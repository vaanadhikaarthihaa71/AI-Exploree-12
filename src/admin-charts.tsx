import React from "react";
import { createRoot, Root } from "react-dom/client";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine
} from "recharts";

interface StudentRecord {
  studentId: string;
  studentName?: string;
  registeredAt?: string;
  createdAt?: string;
  [key: string]: any;
}

interface QuizAttemptRecord {
  score?: number;
  percentage?: number;
  createdAt?: string;
  timestamp?: any;
  studentId?: string;
  [key: string]: any;
}

interface DailyRegistrationPoint {
  date: string;
  dateFormatted: string;
  dailyRegistrations: number;
  cumulativeRegistrations: number;
}

interface DailyScorePoint {
  date: string;
  dateFormatted: string;
  avgScore: number;
  avgPercentage: number;
  highestScore: number;
  attemptsCount: number;
  masteryBenchmark: number;
}

function parseDateKey(val: any): string {
  if (!val) return new Date().toISOString().slice(0, 10);
  if (typeof val === "string") {
    return val.slice(0, 10);
  }
  if (val.toDate && typeof val.toDate === "function") {
    return val.toDate().toISOString().slice(0, 10);
  }
  if (val.seconds) {
    return new Date(val.seconds * 1000).toISOString().slice(0, 10);
  }
  const d = new Date(val);
  return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function formatDateLabel(isoDate: string): string {
  try {
    const parts = isoDate.split("-");
    if (parts.length === 3) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      return `${months[m] || parts[1]} ${d}`;
    }
  } catch (e) {}
  return isoDate;
}

// 1. Process Registrations Per Day
export function processRegistrationsData(students: StudentRecord[]): DailyRegistrationPoint[] {
  if (!students || students.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return [
      { date: today, dateFormatted: formatDateLabel(today), dailyRegistrations: 0, cumulativeRegistrations: 0 }
    ];
  }

  const countsByDate: Record<string, number> = {};
  students.forEach((s) => {
    const dKey = parseDateKey(s.registeredAt || s.createdAt);
    countsByDate[dKey] = (countsByDate[dKey] || 0) + 1;
  });

  const sortedDates = Object.keys(countsByDate).sort();

  let runningTotal = 0;
  return sortedDates.map((dKey) => {
    const daily = countsByDate[dKey] || 0;
    runningTotal += daily;
    return {
      date: dKey,
      dateFormatted: formatDateLabel(dKey),
      dailyRegistrations: daily,
      cumulativeRegistrations: runningTotal
    };
  });
}

// 2. Process Average Quiz Scores Achieved
export function processQuizScoresData(quizAttempts: QuizAttemptRecord[]): DailyScorePoint[] {
  if (!quizAttempts || quizAttempts.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return [
      {
        date: today,
        dateFormatted: formatDateLabel(today),
        avgScore: 0,
        avgPercentage: 0,
        highestScore: 0,
        attemptsCount: 0,
        masteryBenchmark: 12
      }
    ];
  }

  const attemptsByDate: Record<string, number[]> = {};
  quizAttempts.forEach((q) => {
    if (typeof q.score === "number" && !isNaN(q.score)) {
      const dKey = parseDateKey(q.createdAt || q.timestamp);
      if (!attemptsByDate[dKey]) attemptsByDate[dKey] = [];
      attemptsByDate[dKey].push(q.score);
    }
  });

  const sortedDates = Object.keys(attemptsByDate).sort();
  if (sortedDates.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return [
      {
        date: today,
        dateFormatted: formatDateLabel(today),
        avgScore: 0,
        avgPercentage: 0,
        highestScore: 0,
        attemptsCount: 0,
        masteryBenchmark: 12
      }
    ];
  }

  return sortedDates.map((dKey) => {
    const scores = attemptsByDate[dKey] || [0];
    const sum = scores.reduce((acc, s) => acc + s, 0);
    const avg = Number((sum / scores.length).toFixed(1));
    const highest = Math.max(...scores);
    const avgPct = Math.round((avg / 15) * 100);

    return {
      date: dKey,
      dateFormatted: formatDateLabel(dKey),
      avgScore: avg,
      avgPercentage: avgPct,
      highestScore: highest,
      attemptsCount: scores.length,
      masteryBenchmark: 12
    };
  });
}

// Custom Glassmorphic Dark Tooltip
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div
        style={{
          background: "rgba(15, 23, 42, 0.96)",
          border: "1px solid rgba(53, 217, 255, 0.35)",
          boxShadow: "0 10px 25px rgba(0,0,0,0.6)",
          borderRadius: "10px",
          padding: "0.75rem 1rem",
          color: "#E2E8F0",
          fontSize: "0.82rem",
          minWidth: "160px"
        }}
      >
        <div style={{ fontWeight: 800, color: "#FFFFFF", marginBottom: "0.4rem", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "0.25rem" }}>
          📅 {label}
        </div>
        {payload.map((entry: any, index: number) => (
          <div key={`item-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", margin: "0.25rem 0", color: entry.color }}>
            <span style={{ color: "#94A3B8" }}>{entry.name}:</span>
            <strong style={{ fontFamily: "monospace", fontSize: "0.88rem" }}>
              {entry.value} {entry.unit || ""}
            </strong>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// Component 1: Daily Registrations Chart
export const RegistrationsChart: React.FC<{ data: DailyRegistrationPoint[] }> = ({ data }) => {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ResponsiveContainer width="100%" height={290}>
        <ComposedChart data={data} margin={{ top: 15, right: 20, bottom: 15, left: 0 }}>
          <defs>
            <linearGradient id="cyanBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#35D9FF" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#0284C7" stopOpacity={0.4} />
            </linearGradient>
            <linearGradient id="purpleLineGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#C084FC" stopOpacity={0.8} />
              <stop offset="100%" stopColor="#7E22CE" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255, 255, 255, 0.07)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="dateFormatted"
            stroke="#64748B"
            tick={{ fill: "#94A3B8", fontSize: 11 }}
            axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
            tickLine={false}
          />
          <YAxis
            yAxisId="left"
            stroke="#64748B"
            tick={{ fill: "#35D9FF", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#64748B"
            tick={{ fill: "#A855F7", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: "8px", fontSize: "12px" }}
            formatter={(val) => <span style={{ color: "#E2E8F0", fontWeight: 600 }}>{val}</span>}
          />
          <Bar
            yAxisId="left"
            dataKey="dailyRegistrations"
            name="Daily Registrations"
            fill="url(#cyanBarGrad)"
            radius={[6, 6, 0, 0]}
            maxBarSize={48}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumulativeRegistrations"
            name="Cumulative Total"
            stroke="#A855F7"
            strokeWidth={3}
            dot={{ r: 4, fill: "#C084FC", stroke: "#0F172A", strokeWidth: 2 }}
            activeDot={{ r: 6, fill: "#FFFFFF", stroke: "#A855F7", strokeWidth: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

// Component 2: Average Quiz Scores Achieved Trend
export const QuizScoresChart: React.FC<{ data: DailyScorePoint[] }> = ({ data }) => {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ResponsiveContainer width="100%" height={290}>
        <ComposedChart data={data} margin={{ top: 15, right: 20, bottom: 15, left: 0 }}>
          <defs>
            <linearGradient id="emeraldAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10B981" stopOpacity={0.65} />
              <stop offset="100%" stopColor="#047857" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255, 255, 255, 0.07)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="dateFormatted"
            stroke="#64748B"
            tick={{ fill: "#94A3B8", fontSize: 11 }}
            axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
            tickLine={false}
          />
          <YAxis
            stroke="#64748B"
            domain={[0, 15]}
            ticks={[0, 3, 6, 9, 12, 15]}
            tick={{ fill: "#34D399", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: "8px", fontSize: "12px" }}
            formatter={(val) => <span style={{ color: "#E2E8F0", fontWeight: 600 }}>{val}</span>}
          />
          <ReferenceLine
            y={12}
            stroke="#FFD700"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{
              value: "80% Benchmark (12/15)",
              fill: "#FFD700",
              position: "insideTopLeft",
              fontSize: 10,
              fontWeight: 700
            }}
          />
          <Area
            type="monotone"
            dataKey="avgScore"
            name="Average Quiz Score"
            unit="/ 15"
            stroke="#10B981"
            strokeWidth={3}
            fill="url(#emeraldAreaGrad)"
            activeDot={{ r: 6, fill: "#34D399", stroke: "#FFFFFF", strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="highestScore"
            name="Highest Score"
            unit="/ 15"
            stroke="#FFD700"
            strokeWidth={2}
            strokeDasharray="2 2"
            dot={{ r: 3, fill: "#FFD700" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

// Root containers map to prevent re-creating roots
let regRoot: Root | null = null;
let scoreRoot: Root | null = null;

export function renderAdminRecharts(payload: { students: StudentRecord[]; quizAttempts: QuizAttemptRecord[] }) {
  const { students = [], quizAttempts = [] } = payload;

  const regData = processRegistrationsData(students);
  const scoreData = processQuizScoresData(quizAttempts);

  // 1. Mount / Render Registrations Chart
  const regContainer = document.getElementById("rechartsRegistrationsContainer");
  if (regContainer) {
    if (!regRoot) {
      regRoot = createRoot(regContainer);
    }
    regRoot.render(<RegistrationsChart data={regData} />);

    const statEl = document.getElementById("chartDailyRegStat");
    if (statEl) {
      statEl.innerText = `${students.length} Registered Students`;
    }
  }

  // 2. Mount / Render Quiz Scores Chart
  const scoreContainer = document.getElementById("rechartsScoresContainer");
  if (scoreContainer) {
    if (!scoreRoot) {
      scoreRoot = createRoot(scoreContainer);
    }
    scoreRoot.render(<QuizScoresChart data={scoreData} />);

    const statEl = document.getElementById("chartAvgScoreStat");
    if (statEl) {
      const latestDay = scoreData[scoreData.length - 1];
      statEl.innerText = latestDay ? `Avg: ${latestDay.avgScore} / 15 (${latestDay.avgPercentage}%)` : "Avg: -- / 15";
    }
  }
}

// Expose on global window object
if (typeof window !== "undefined") {
  (window as any).renderAdminRecharts = renderAdminRecharts;
  (window as any).processRegistrationsData = processRegistrationsData;
  (window as any).processQuizScoresData = processQuizScoresData;

  window.dispatchEvent(new CustomEvent("admin-recharts-ready"));
}
