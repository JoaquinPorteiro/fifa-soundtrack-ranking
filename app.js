import { SONGS } from "./songs.js";

const INITIAL_RATING = 1500;
const POLL_INTERVAL_MS = 12_000;

const state = {
  ratings: Object.fromEntries(
    SONGS.map((s) => [s.id, { rating: INITIAL_RATING, wins: 0, losses: 0, matches: 0 }])
  ),
  totalMatches: 0,
  loading: true,
};

const els = {
  cardA: document.getElementById("card-a"),
  cardB: document.getElementById("card-b"),
  skipBtn: document.getElementById("skip-btn"),
  list: document.getElementById("ranking-list"),
  statMatches: document.getElementById("stat-matches"),
  statSongs: document.getElementById("stat-songs"),
  navLinks: document.querySelectorAll(".nav-link"),
};

let currentPair = null;
let voteInFlight = false;

async function fetchState() {
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error(`state ${res.status}`);
  const data = await res.json();
  for (const id in data.ratings) {
    if (state.ratings[id]) state.ratings[id] = data.ratings[id];
  }
  state.totalMatches = data.totalMatches;
  state.loading = false;
}

async function postVote(winnerId, loserId) {
  const res = await fetch("/api/vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ winnerId, loserId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `vote ${res.status}`);
  }
  return res.json();
}

function pickPair() {
  if (SONGS.length < 2) return null;
  const sorted = [...SONGS].sort(
    (a, b) => state.ratings[a.id].matches - state.ratings[b.id].matches
  );
  const poolSize = Math.max(2, Math.ceil(SONGS.length / 2));
  const pool = sorted.slice(0, poolSize);
  const a = pool[Math.floor(Math.random() * pool.length)];
  let b;
  do {
    b = SONGS[Math.floor(Math.random() * SONGS.length)];
  } while (b.id === a.id);
  return [a, b];
}

function renderCard(cardEl, song) {
  const r = state.ratings[song.id];
  cardEl.querySelector('[data-field="fifa"]').textContent = song.fifa;
  cardEl.querySelector('[data-field="title"]').textContent = song.title;
  cardEl.querySelector('[data-field="artist"]').textContent = song.artist;
  cardEl.querySelector('[data-field="rating"]').innerHTML =
    `Rating <strong>${r.rating}</strong> · ${r.matches} duelos`;
  cardEl.classList.remove("win", "lose");
  cardEl.disabled = false;
}

function renderDuel() {
  currentPair = pickPair();
  if (!currentPair) return;
  renderCard(els.cardA, currentPair[0]);
  renderCard(els.cardB, currentPair[1]);
}

function renderRanking() {
  const ranked = [...SONGS]
    .map((s) => ({ ...s, ...state.ratings[s.id] }))
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins);

  els.list.innerHTML = ranked
    .map((s, i) => {
      const pos = i + 1;
      const topClass = pos === 1 ? "top1" : pos === 2 ? "top2" : pos === 3 ? "top3" : "";
      const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : pos;
      return `
        <li class="rank-row ${topClass}">
          <div class="rank-pos">${medal}</div>
          <div class="rank-info">
            <div class="rank-title">${escapeHtml(s.title)} <span style="color:var(--text-dim);font-weight:500"> — ${escapeHtml(s.artist)}</span></div>
            <div class="rank-meta">${escapeHtml(s.fifa)}</div>
          </div>
          <div class="rank-record">${s.wins}V · ${s.losses}D</div>
          <div class="rank-rating">${s.rating}</div>
        </li>`;
    })
    .join("");
}

function renderStats() {
  els.statMatches.textContent = state.totalMatches;
  els.statSongs.textContent = SONGS.length;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function handlePick(side) {
  if (!currentPair || voteInFlight) return;
  voteInFlight = true;

  const [a, b] = currentPair;
  const winner = side === "a" ? a : b;
  const loser = side === "a" ? b : a;
  const winnerEl = side === "a" ? els.cardA : els.cardB;
  const loserEl = side === "a" ? els.cardB : els.cardA;

  winnerEl.classList.add("win");
  loserEl.classList.add("lose");
  els.cardA.disabled = true;
  els.cardB.disabled = true;

  try {
    const result = await postVote(winner.id, loser.id);
    state.ratings[result.winnerId].rating = result.winnerRating;
    state.ratings[result.winnerId].wins += 1;
    state.ratings[result.winnerId].matches += 1;
    state.ratings[result.loserId].rating = result.loserRating;
    state.ratings[result.loserId].losses += 1;
    state.ratings[result.loserId].matches += 1;
    state.totalMatches += 1;
    renderStats();
    renderRanking();
  } catch (err) {
    console.error(err);
    winnerEl.classList.remove("win");
    loserEl.classList.remove("lose");
    alert("No se pudo registrar el voto. Probá de nuevo.");
  } finally {
    voteInFlight = false;
    setTimeout(() => renderDuel(), 380);
  }
}

els.cardA.addEventListener("click", () => handlePick("a"));
els.cardB.addEventListener("click", () => handlePick("b"));
els.skipBtn.addEventListener("click", () => renderDuel());

const sections = ["vote", "ranking"].map((id) => document.getElementById(id));
const setActiveLink = (id) => {
  els.navLinks.forEach((a) => a.classList.toggle("active", a.dataset.target === id));
};
const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) if (e.isIntersecting) setActiveLink(e.target.id);
  },
  { rootMargin: "-40% 0px -55% 0px" }
);
sections.forEach((s) => s && observer.observe(s));

window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === "ArrowLeft") { e.preventDefault(); handlePick("a"); }
  else if (e.key === "ArrowRight") { e.preventDefault(); handlePick("b"); }
  else if (e.key === " ") { e.preventDefault(); renderDuel(); }
});

// Live-refresh ranking from other users' votes while the tab is visible.
setInterval(() => {
  if (document.hidden || voteInFlight) return;
  fetchState().then(() => {
    renderStats();
    renderRanking();
  }).catch(() => {});
}, POLL_INTERVAL_MS);

(async function init() {
  renderStats();
  renderRanking();
  try {
    await fetchState();
  } catch (err) {
    console.error("No pude cargar el estado:", err);
  }
  renderStats();
  renderRanking();
  renderDuel();
})();
