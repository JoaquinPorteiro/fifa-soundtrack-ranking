import { Redis } from "@upstash/redis";
import { SONGS } from "../songs.js";
import { INITIAL_RATING, applyElo } from "./_lib/elo.js";

const redis = Redis.fromEnv();
const VALID_IDS = new Set(SONGS.map((s) => s.id));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const { winnerId, loserId } = body;

  if (
    typeof winnerId !== "string" ||
    typeof loserId !== "string" ||
    !VALID_IDS.has(winnerId) ||
    !VALID_IDS.has(loserId) ||
    winnerId === loserId
  ) {
    return res.status(400).json({ error: "Invalid vote" });
  }

  const [w, l] = await Promise.all([
    redis.hgetall(`stats:${winnerId}`),
    redis.hgetall(`stats:${loserId}`),
  ]);
  const wRating = Number(w?.rating ?? INITIAL_RATING);
  const lRating = Number(l?.rating ?? INITIAL_RATING);

  const { newWinner, newLoser } = applyElo(wRating, lRating);

  // Pipelined writes — best-effort atomicity at the call level. A read-modify-write
  // race is possible under high concurrency; acceptable for this app's traffic.
  const p = redis.pipeline();
  p.hset(`stats:${winnerId}`, { rating: newWinner });
  p.hincrby(`stats:${winnerId}`, "wins", 1);
  p.hincrby(`stats:${winnerId}`, "matches", 1);
  p.hset(`stats:${loserId}`, { rating: newLoser });
  p.hincrby(`stats:${loserId}`, "losses", 1);
  p.hincrby(`stats:${loserId}`, "matches", 1);
  p.incr("total_matches");
  await p.exec();

  res.json({
    winnerId,
    loserId,
    winnerRating: newWinner,
    loserRating: newLoser,
    winnerDelta: newWinner - wRating,
    loserDelta: newLoser - lRating,
  });
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
