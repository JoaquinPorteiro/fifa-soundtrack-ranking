export const INITIAL_RATING = 1500;
export const K_FACTOR = 32;

export function expectedScore(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

export function applyElo(winnerRating, loserRating) {
  const ew = expectedScore(winnerRating, loserRating);
  const newWinner = Math.round(winnerRating + K_FACTOR * (1 - ew));
  const newLoser = Math.round(loserRating + K_FACTOR * (0 - (1 - ew)));
  return { newWinner, newLoser };
}
