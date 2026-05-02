import { SONGS } from "./songs.js";

const INITIAL_RATING = 1500;
const POLL_INTERVAL_MS = 12_000;
const FILTER_STORAGE_KEY = "ranking-filter-edition";
const EDITIONS = [...new Set(SONGS.map((s) => s.fifa))];

const state = {
  ratings: Object.fromEntries(
    SONGS.map((s) => [s.id, { rating: INITIAL_RATING, wins: 0, losses: 0, matches: 0 }])
  ),
  totalMatches: 0,
};

let youtubeIds = {};
let youtubeStarts = {};

const isVotePage = !!document.getElementById("card-a");
const isRankingPage = !!document.getElementById("ranking-list");

// ---------- Shared API ----------

async function fetchState() {
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error(`state ${res.status}`);
  const data = await res.json();
  for (const id in data.ratings) {
    if (state.ratings[id]) state.ratings[id] = data.ratings[id];
  }
  state.totalMatches = data.totalMatches;
}

async function fetchYoutubeIds() {
  try {
    const res = await fetch("./data/youtube_ids.json", { cache: "no-store" });
    if (!res.ok) return;
    youtubeIds = await res.json();
  } catch {}
}

async function fetchYoutubeStarts() {
  try {
    const res = await fetch("./data/youtube_starts.json", { cache: "no-store" });
    if (!res.ok) return;
    youtubeStarts = await res.json();
  } catch {}
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

// ---------- Shared helpers ----------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderStats() {
  const s = document.getElementById("stat-songs");
  if (s) s.textContent = SONGS.length;
}

// ---------- Vote page ----------

let currentPair = null;
let voteInFlight = false;
let voteRefs = null;

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

function renderMedia(mediaEl, song) {
  const ytId = youtubeIds[song.id];
  if (!ytId) {
    const q = encodeURIComponent(`${song.title} ${song.artist}`);
    mediaEl.innerHTML = `
      <div class="media-fallback">
        <a class="media-search" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener" data-no-vote>
          ↗ Search on YouTube
        </a>
      </div>`;
    return;
  }
  mediaEl.innerHTML = `
    <img class="media-thumb" src="https://i.ytimg.com/vi/${ytId}/mqdefault.jpg" alt="" loading="lazy" />
    <button type="button" class="media-play" data-no-vote aria-label="Play preview">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
    </button>`;
}

function loadIframe(mediaEl, song) {
  const ytId = youtubeIds[song.id];
  if (!ytId) return;
  const startSec = youtubeStarts[song.id];
  const startParam = Number.isInteger(startSec) && startSec > 0 ? `&start=${startSec}` : "";
  mediaEl.innerHTML = `
    <iframe
      class="media-iframe"
      src="https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1${startParam}"
      title="${escapeHtml(song.title)} — ${escapeHtml(song.artist)}"
      frameborder="0"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowfullscreen
      data-no-vote></iframe>`;
}

function renderCard(cardEl, song) {
  const r = state.ratings[song.id];
  cardEl.dataset.songId = song.id;
  cardEl.querySelector('[data-field="fifa"]').textContent = song.fifa;
  cardEl.querySelector('[data-field="title"]').textContent = song.title;
  cardEl.querySelector('[data-field="artist"]').textContent = song.artist;
  const ratingEl = cardEl.querySelector('[data-field="rating"]');
  if (ratingEl) ratingEl.innerHTML = `Rating <strong>${r.rating}</strong>`;
  renderMedia(cardEl.querySelector('[data-field="media"]'), song);
  cardEl.classList.remove("win", "lose");
  cardEl.removeAttribute("aria-disabled");
}

function renderDuel() {
  if (!voteRefs) return;
  currentPair = pickPair();
  if (!currentPair) return;
  renderCard(voteRefs.cardA, currentPair[0]);
  renderCard(voteRefs.cardB, currentPair[1]);
}

function updateCurrentDuelRatings() {
  if (!voteRefs || !currentPair) return;
  const [a, b] = currentPair;
  const ratingA = voteRefs.cardA.querySelector('[data-field="rating"]');
  const ratingB = voteRefs.cardB.querySelector('[data-field="rating"]');
  if (ratingA) ratingA.innerHTML = `Rating <strong>${state.ratings[a.id].rating}</strong>`;
  if (ratingB) ratingB.innerHTML = `Rating <strong>${state.ratings[b.id].rating}</strong>`;
}

async function handlePick(side) {
  if (!currentPair || voteInFlight || !voteRefs) return;
  voteInFlight = true;

  const [a, b] = currentPair;
  const winner = side === "a" ? a : b;
  const loser = side === "a" ? b : a;
  const winnerEl = side === "a" ? voteRefs.cardA : voteRefs.cardB;
  const loserEl = side === "a" ? voteRefs.cardB : voteRefs.cardA;

  winnerEl.classList.add("win");
  loserEl.classList.add("lose");
  voteRefs.cardA.setAttribute("aria-disabled", "true");
  voteRefs.cardB.setAttribute("aria-disabled", "true");

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
  } catch (err) {
    console.error(err);
    winnerEl.classList.remove("win");
    loserEl.classList.remove("lose");
    alert("Couldn't record your vote. Try again.");
  } finally {
    voteInFlight = false;
    setTimeout(() => renderDuel(), 380);
  }
}

function attachCardHandlers(cardEl, side) {
  cardEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-no-vote]")) return;
    if (cardEl.getAttribute("aria-disabled") === "true") return;
    handlePick(side);
  });
  cardEl.addEventListener("keydown", (e) => {
    if (e.target !== cardEl) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handlePick(side);
    }
  });
}

function handleMediaClick(e) {
  const playBtn = e.target.closest(".media-play");
  if (!playBtn) return;
  e.stopPropagation();
  const cardEl = playBtn.closest(".card");
  if (!cardEl || !currentPair) return;
  const side = cardEl.dataset.side;
  const song = side === "a" ? currentPair[0] : currentPair[1];
  loadIframe(cardEl.querySelector('[data-field="media"]'), song);
}

if (isVotePage) {
  voteRefs = {
    cardA: document.getElementById("card-a"),
    cardB: document.getElementById("card-b"),
    skipBtn: document.getElementById("skip-btn"),
  };
  attachCardHandlers(voteRefs.cardA, "a");
  attachCardHandlers(voteRefs.cardB, "b");
  voteRefs.cardA.addEventListener("click", handleMediaClick, true);
  voteRefs.cardB.addEventListener("click", handleMediaClick, true);
  voteRefs.skipBtn.addEventListener("click", () => renderDuel());

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.target.tagName === "IFRAME") return;
    if (e.key === "ArrowLeft") { e.preventDefault(); handlePick("a"); }
    else if (e.key === "ArrowRight") { e.preventDefault(); handlePick("b"); }
    else if (e.key === " ") { e.preventDefault(); renderDuel(); }
  });
}

// ---------- Ranking page ----------

let rankingFilter = localStorage.getItem(FILTER_STORAGE_KEY) || "";
let rankingRefs = null;

function renderRanking() {
  if (!rankingRefs) return;
  const pool = rankingFilter
    ? SONGS.filter((s) => s.fifa === rankingFilter)
    : SONGS;
  const ranked = pool
    .map((s) => ({ ...s, ...state.ratings[s.id] }))
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins);

  if (rankingRefs.filterCount) {
    rankingRefs.filterCount.textContent = `${ranked.length} songs`;
  }

  rankingRefs.list.innerHTML = ranked
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
          <div class="rank-rating">${s.rating}</div>
        </li>`;
    })
    .join("");
}

function populateFilter() {
  if (!rankingRefs?.filter) return;
  for (const ed of EDITIONS) {
    const opt = document.createElement("option");
    opt.value = ed;
    opt.textContent = ed;
    rankingRefs.filter.appendChild(opt);
  }
  rankingRefs.filter.value = rankingFilter;
  rankingRefs.filter.addEventListener("change", () => {
    rankingFilter = rankingRefs.filter.value;
    if (rankingFilter) localStorage.setItem(FILTER_STORAGE_KEY, rankingFilter);
    else localStorage.removeItem(FILTER_STORAGE_KEY);
    renderRanking();
  });
}

if (isRankingPage) {
  rankingRefs = {
    list: document.getElementById("ranking-list"),
    filter: document.getElementById("ranking-filter"),
    filterCount: document.getElementById("filter-count"),
  };
  populateFilter();

  // Live-refresh from other users' votes while the tab is visible.
  setInterval(() => {
    if (document.hidden) return;
    fetchState().then(() => {
      renderStats();
      renderRanking();
    }).catch(() => {});
  }, POLL_INTERVAL_MS);
}

// ---------- Init ----------

(async function init() {
  renderStats();

  // YouTube IDs + chorus start times are static JSON files — fast. Wait for them
  // so the first paint already includes thumbnails and the right start offset,
  // but DON'T block on the API (it can cold-start for ~10s on Vercel and would
  // leave the cards visually empty until then).
  await Promise.all([fetchYoutubeIds(), fetchYoutubeStarts()]);

  if (isVotePage) renderDuel();
  // Ranking is intentionally NOT rendered yet — its <ol> shows a "Loading…"
  // placeholder from HTML until fetchState() resolves with real ratings.

  fetchState()
    .then(() => {
      if (isVotePage) updateCurrentDuelRatings();
      if (isRankingPage) renderRanking();
    })
    .catch((err) => {
      console.error("Failed to load state:", err);
      if (isRankingPage) renderRanking(); // fallback to defaults if API fails
    });
})();
