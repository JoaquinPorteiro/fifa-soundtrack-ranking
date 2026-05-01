import { Redis } from "@upstash/redis";
import { SONGS } from "../songs.js";
import { INITIAL_RATING } from "./_lib/elo.js";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const [songStats, totalMatchesRaw] = await Promise.all([
    Promise.all(SONGS.map((s) => redis.hgetall(`stats:${s.id}`))),
    redis.get("total_matches"),
  ]);

  const ratings = {};
  SONGS.forEach((s, i) => {
    const r = songStats[i] || {};
    ratings[s.id] = {
      rating: Number(r.rating ?? INITIAL_RATING),
      wins: Number(r.wins ?? 0),
      losses: Number(r.losses ?? 0),
      matches: Number(r.matches ?? 0),
    };
  });

  res.setHeader("Cache-Control", "no-store");
  res.json({
    ratings,
    totalMatches: Number(totalMatchesRaw ?? 0),
  });
}
