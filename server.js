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

async function getStandingsTable(competition) {
  const data = await fdFetch(`/competitions/${competition}/standings`);
  const totalTable = data.standings.find((s) => s.type === "TOTAL") || data.standings[0];
  return totalTable.table;
}

app.get("/api/teams", async (req, res) => {
  try {
    const { competition } = req.query;
    const table = await getStandingsTable(competition);
    res.json(table.map((row) => ({ id: row.team.id, name: row.team.name })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/predict", async (req, res) => {
  try {
    const { teamAId, teamBId, competition } = req.query;
    if (!teamAId || !teamBId || !competition) {
      return res.status(400).json({ error: "ต้องระบุ teamAId, teamBId และ competition" });
    }
    const table = await getStandingsTable(competition);
    const rowA = table.find((r) => r.team.id === Number(teamAId));
    const rowB = table.find((r) => r.team.id === Number(teamBId));
    if (!rowA || !rowB) return res.status(404).json({ error: "ไม่พบทีมในตารางคะแนน" });

    const statsOf = (row) => ({
      formPoints: (row.points / row.playedGames) * 5,
      avgGoalsFor: row.goalsFor / row.playedGames,
      avgGoalsAgainst: row.goalsAgainst / row.playedGames,
      matchesFound: row.playedGames,
    });
    const formA = statsOf(rowA);
    const formB = statsOf(rowB);

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
      note: "คำนวณจากสถิติฤดูกาลนี้จริง (ตารางคะแนน) แต่ไม่ใช่การรับประกันผลลัพธ์",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
