/**
 * Cross-host show matching.
 *
 * Provider ids are not portable: AnimeUnity uses `{numericId}-{slug}`, HiAnime a
 * slug, and the two shapes overlap (`7775-the-ramparts-of-ice-2` is a **HiAnime**
 * id that looks like an AnimeUnity one), so an id can never be classified by its
 * shape. Whenever the app has to continue a show on a host other than the one
 * that produced the id, the show has to be looked up again by title.
 *
 * The only key that is genuinely stable across hosts is the AniList media id:
 * AnimeUnity publishes it in every archive record (`anilist_id`, exposed as
 * `ShowSearchResult.id`), HiAnime reports it on the show page. When it is known,
 * a candidate carrying the same id wins outright.
 *
 * Otherwise the decision is made on titles — and it is deliberately allowed to
 * decide *nothing*. Picking `results[0]` (the previous behaviour) opened the
 * first season of a show the user was watching in its second season, which
 * presents exactly like "the host switch is broken". Refusing to match surfaces
 * as "this show is not available on the selected host", which is honest and
 * recoverable.
 */

/** Words that introduce a season, mapped to the season number they mean. */
const SEASON_WORDS: Record<string, number> = {
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
};

const ROMAN_SEASONS: Record<string, number> = {
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
};

export interface ParsedShowTitle {
  /** Normalised base title with any season marker removed. */
  base: string;
  /** Season number when the title states one explicitly. */
  season: number | null;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .trim();
}

/**
 * Split a title into its base and its season marker.
 *
 * Markers are matched from most explicit to least: "Season 2" / "2nd Season" /
 * "Second Season", the Japanese "第2期", a trailing roman numeral ("Dan Da Dan
 * II") and finally a trailing single digit ("Dan Da Dan 2"). A title without a
 * marker (the usual case) simply has `season: null`.
 */
export function parseShowTitle(raw: string): ParsedShowTitle {
  const text = ` ${raw.trim()} `;
  const strip = (match: RegExpExecArray): string =>
    `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;

  const patterns: Array<{ re: RegExp; season: (m: RegExpExecArray) => number | null }> = [
    {
      re: /\b(?:season|part|cour|series)\s*(\d{1,2})\b/i,
      season: (m) => Number(m[1]),
    },
    {
      re: /\b(\d{1,2})\s*(?:st|nd|rd|th)\s+season\b/i,
      season: (m) => Number(m[1]),
    },
    {
      re: /\b(\w+)\s+season\b/i,
      season: (m) => SEASON_WORDS[(m[1] ?? "").toLowerCase()] ?? null,
    },
    {
      re: /第\s*(\d{1,2})\s*期/,
      season: (m) => Number(m[1]),
    },
    {
      re: /\b(ii|iii|iv|v|vi|vii|viii|ix|x)\s*$/i,
      season: (m) => ROMAN_SEASONS[(m[1] ?? "").toLowerCase()] ?? null,
    },
    {
      re: /\b([1-9])\s*$/,
      season: (m) => Number(m[1]),
    },
  ];

  for (const { re, season } of patterns) {
    const match = re.exec(text);
    if (!match) continue;
    const value = season(match);
    if (value == null) continue;
    return { base: normalize(strip(match)), season: value };
  }

  return { base: normalize(text), season: null };
}

/**
 * Pick between two seasons.
 *
 * A candidate that states the *same* season as the query is a strong positive; a
 * candidate that states a *different* one is a strong negative. A missing marker
 * is treated as unknown rather than as season 1, so "Dan Da Dan" can still match
 * a query for "Dan Da Dan Season 2" — just not as confidently as "Dan Da Dan 2".
 */
function seasonScore(querySeason: number | null, candidateSeason: number | null): number {
  if (querySeason != null && candidateSeason != null) {
    return querySeason === candidateSeason ? 150 : -400;
  }
  if (querySeason != null) return -150;
  if (candidateSeason != null) return candidateSeason === 1 ? 0 : -300;
  return 0;
}

/** Token overlap, 0..1, on normalised bases. */
function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.max(left.size, right.size);
}

function titleScore(queryBase: string, candidateBase: string): number {
  if (!queryBase || !candidateBase) return 0;
  if (queryBase === candidateBase) return 400;
  // "dan da dan" vs "dandadan": same title, different spacing.
  const compactQuery = queryBase.replace(/ /g, "");
  const compactCandidate = candidateBase.replace(/ /g, "");
  if (compactQuery === compactCandidate) return 400;
  if (queryBase.includes(candidateBase) || candidateBase.includes(queryBase)) return 300;
  if (compactQuery.includes(compactCandidate) || compactCandidate.includes(compactQuery)) {
    return 300;
  }
  // Every token of the shorter title appears in the longer one
  // ("magical destroyers" ⊂ "magical girl magical destroyers").
  const [shorter, longer] =
    queryBase.length <= candidateBase.length
      ? [queryBase, candidateBase]
      : [candidateBase, queryBase];
  const longerTokens = new Set(longer.split(" ").filter(Boolean));
  const shorterTokens = shorter.split(" ").filter(Boolean);
  if (shorterTokens.length > 0 && shorterTokens.every((token) => longerTokens.has(token))) {
    return 250;
  }
  const overlap = tokenOverlap(queryBase, candidateBase);
  return overlap >= 0.5 ? Math.round(overlap * 200) : 0;
}

export interface ShowMatchCandidate {
  providerId: string;
  /** Provider-exposed id: the AniList media id when the provider knows one. */
  id?: string;
  title: {
    english?: string | null;
    romanji?: string | null;
    native?: string | null;
  };
  availableEpisodes?: { sub?: number; dub?: number; raw?: number } | null;
}

export interface ShowMatchQuery {
  /** Titles for the show being continued, most specific first. */
  titles: Array<string | null | undefined>;
  /** AniList media id when known — the one cross-host stable identifier. */
  anilistMediaId?: number | null;
  /** Episode number in play, used to reject shows that cannot contain it. */
  episodeIndex?: number | null;
}

/**
 * Score one candidate against the query titles.
 *
 * The candidate is accepted when the provider itself confirms the show (AniList
 * id match) or when a title is recognisably the same *and* the two do not
 * disagree about which season it is. An explicit season contradiction — one side
 * says season 2, the other says season 1 or omits it — is a rejection, not a
 * penalty: opening the wrong season is the failure this function exists to stop.
 */
export function scoreShowCandidate(candidate: ShowMatchCandidate, query: ShowMatchQuery): number {
  const idMatched =
    query.anilistMediaId != null && candidate.id === String(query.anilistMediaId);

  const candidateTitles = [
    candidate.title.english,
    candidate.title.romanji,
    candidate.title.native,
  ]
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => parseShowTitle(t));

  let bestTitle = 0;
  let bestSeason = 0;
  for (const title of query.titles) {
    if (!title || !title.trim()) continue;
    const parsedQuery = parseShowTitle(title);
    for (const parsedCandidate of candidateTitles) {
      const titlePart = titleScore(parsedQuery.base, parsedCandidate.base);
      const seasonPart = seasonScore(parsedQuery.season, parsedCandidate.season);
      if (titlePart + seasonPart > bestTitle + bestSeason) {
        bestTitle = titlePart;
        bestSeason = seasonPart;
      }
    }
  }

  // The provider itself says this is the show: the id is the strongest evidence
  // there is, and a fuzzy title (or a title in another language) must not veto it.
  if (idMatched) return 1000 + Math.max(bestTitle + bestSeason, 0);

  if (bestTitle < MIN_TITLE_SCORE) return 0;
  if (bestSeason < 0) return 0;

  let score = bestTitle + bestSeason;
  const declaredEpisodes =
    candidate.availableEpisodes?.sub ??
    candidate.availableEpisodes?.dub ??
    candidate.availableEpisodes?.raw ??
    null;
  const wanted = query.episodeIndex;
  if (declaredEpisodes != null && declaredEpisodes > 0 && wanted != null && wanted > 0) {
    score += wanted > declaredEpisodes ? -300 : 50;
  }
  return Math.max(score, 0);
}

/** Weakest title evidence that may still identify a show (containment / subsets). */
export const MIN_TITLE_SCORE = 250;
/** Minimum score a candidate needs before the app will continue a show on it. */
export const MIN_SHOW_MATCH_SCORE = MIN_TITLE_SCORE;

export function pickBestShowMatch<T extends ShowMatchCandidate>(
  candidates: T[],
  query: ShowMatchQuery
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreShowCandidate(candidate, query);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= MIN_SHOW_MATCH_SCORE ? best : null;
}

/** True when this candidate is the AniList entry itself — no further search needed. */
export function isDecisiveShowMatch(
  candidate: ShowMatchCandidate,
  anilistMediaId: number | null | undefined
): boolean {
  return anilistMediaId != null && candidate.id === String(anilistMediaId);
}

/**
 * Search queries that give a provider's catalogue a chance to answer.
 *
 * Catalogues index one spelling of a title, and season phrasing differs between
 * them ("Dan Da Dan Season 2" answers with nothing on AnimeUnity, while
 * "Dan Da Dan" returns the whole family and "Dan Da Dan 2" the sequel record), so
 * every language variant is tried first, then its season-stripped and
 * season-normalised forms.
 */
export function buildShowSearchQueries(
  titles: Array<string | null | undefined>,
  limit = 12
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    if (out.length >= limit) return;
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  const usable = titles.filter((t): t is string => typeof t === "string" && t.trim().length > 0);

  // Pass 1: the titles themselves, spelled the way the providers spell them and
  // stripped of punctuation the user's title may carry (or lack).
  for (const title of usable) {
    push(title);
    push(title.replace(/[^\p{L}\p{N}\s]/gu, " "));
  }

  // Pass 2: season-normalised forms.
  for (const title of usable) {
    const { base, season } = parseShowTitle(title);
    if (!base || season == null) continue;
    push(base);
    push(`${base} ${String(season)}`);
    const compact = base.replace(/ /g, "");
    if (compact !== base && compact.length >= 4) push(compact);
  }

  return out;
}

/**
 * Titles to search a provider with, for an AniList list entry, richest first.
 *
 * AniList exposes the same show under several names and catalogues index
 * different ones, so every spelling is offered to the matcher. `userPreferred`
 * leads because it is the title the user is actually looking at.
 */
export function showTitlesFromAniListMedia(media: {
  title?: {
    english?: string | null;
    romaji?: string | null;
    native?: string | null;
    userPreferred?: string | null;
  } | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: string | null | undefined): void => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };

  add(media.title?.userPreferred);
  add(media.title?.english);
  add(media.title?.romaji);
  add(media.title?.native);
  return out;
}
