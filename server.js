import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE_URL = "https://api.football-data.org/v4";

app.use(express.static(path.join(__dirname, "public")));

async function fdFetch(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { "X-Auth-Token": API_KEY || "" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`football-data.org error ${res.status}: ${body}`);
  }
  return res.json();
}

const COMPETITIONS = {
  PL: "พรีเมียร์ลีก (อังกฤษ)",
  PD: "ลาลีกา (สเปน)",
  BL1: "บุนเดสลีกา (เยอรมนี)",
  SA: "กัลโช่ เซเรีย อา (อิตาลี)",
  FL1: "ลีกเอิง (ฝรั่งเศส)",
  CL: "ยูฟ่า แชมเปียนส์ลีก",
};

app.get("/api/competitions", (req, res) => res.json(COMPETITIONS));

app.get("/api/teams", async (req, res) => {
  try {
    const { competition } = req.query;
    const data = await fdFetch(`/competitions/${competition}/teams`);
    res.json(data.teams.map((t) => ({ id: t.id, name: t.name })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getTeamForm(teamId) {
  const data = await fdFetch(`/teams/${teamId}/matches?status=FINISHED&limit=5`);
  let points = 0, goalsFor = 0, goalsAgainst = 0;
  const matches = data.matches || [];
  matches.forEach((m) => {
    const isHome = m.homeTeam.id === teamId;
    const gf = isHome ? m.score.fullTime.home : m.score.fullTime.away;
    const ga = isHome ? m.score.fullTime.away : m.score.fullTime.home;
    goalsFor += gf ?? 0;
    goalsAgainst += ga ?? 0;
    if (gf > ga) points += 3;
    else if (gf === ga) points += 1;
  });
  const played = matches.length || 1;
  return { formPoints: points, avgGoalsFor: goalsFor / played, avgGoalsAgainst: goalsAgainst / played, matchesFound: matches.length };
}

app.get("/api/predict", async (req, res) => {
  try {
    const { teamAId, teamBId } = req.query;
    if (!teamAId || !teamBId) return res.status(400).json({ error: "ต้องระบุ teamAId และ teamBId" });

    const [formA, formB] = await Promise.all([getTeamForm(Number(teamAId)), getTeamForm(Number(teamBId))]);

    const homeAdv = 3;
    const strengthA = formA.formPoints * 4 + formA.avgGoalsFor * 10 - formA.avgGoalsAgainst * 4 + homeAdv;
    const strengthB = formB.formPoints * 4 + formB.avgGoalsFor * 10 - formB.avgGoalsAgainst * 4;
    const diff = strengthA - strengthB;
    const pA = 1 / (1 + Math.pow(10, -diff / 25));

    let winA = pA * 0.78, winB = (1 - pA) * 0.78, draw = 1 - winA - winB;
    if (draw < 0.1) {
      draw = 0.1;
      const s = winA + winB;
      winA = (winA / s) * 0.9;
      winB = (winB / s) * 0.9;
    }

    const predA = Math.max(0, Math.round(formA.avgGoalsFor * 0.5 + formB.avgGoalsAgainst * 0.3 + homeAdv / 10));
    const predB = Math.max(0, Math.round(formB.avgGoalsFor * 0.5 + formA.avgGoalsAgainst * 0.3));

    res.json({
      teamA: { ...formA, winPct: Math.round(winA * 100) },
      teamB: { ...formB, winPct: Math.round(winB * 100) },
      drawPct: Math.round(draw * 100),
      predictedScore: { home: predA, away: predB },
      note: "คำนวณจากฟอร์ม 5 นัดล่าสุดและค่าเฉลี่ยยิง-เสียจริง แต่ไม่ใช่การรับประกันผลลัพธ์",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
