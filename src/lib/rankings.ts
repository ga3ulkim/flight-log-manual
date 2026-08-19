import type { RankingEntry } from '../types';

export const DEFAULT_RANKING_LIMIT = 10;

export interface RankingDisclosure {
  entries: readonly RankingEntry[];
  total: number;
  canToggle: boolean;
}

/** Keep calculation/order untouched and apply only the panel's visible limit. */
export function rankingDisclosure(
  rankings: readonly RankingEntry[],
  expanded: boolean,
  limit = DEFAULT_RANKING_LIMIT,
): RankingDisclosure {
  const safeLimit = Math.max(0, Math.floor(limit));
  const canToggle = rankings.length > safeLimit;
  return {
    entries: canToggle && !expanded ? rankings.slice(0, safeLimit) : rankings,
    total: rankings.length,
    canToggle,
  };
}
