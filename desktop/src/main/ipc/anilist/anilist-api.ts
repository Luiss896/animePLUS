export const ANILIST_GRAPHQL_API = "https://graphql.anilist.co";

interface AniListGraphQlError {
  message?: string;
}

interface AniListGraphQlEnvelope<T> {
  data?: T;
  errors?: AniListGraphQlError[];
}

/**
 * Raised when AniList throttles the request.
 *
 * AniList's documented limit is 90 req/min but the service currently runs
 * degraded at 30/min, and going over returns HTTP 429 with `retry-after`.
 * Callers that make several requests in a row need to tell this apart from a
 * hard failure so they can pause instead of giving up.
 */
export class AniListRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`AniList rate limit reached; retry in ${retryAfterSeconds}s`);
    this.name = "AniListRateLimitError";
  }
}

/** Seconds to wait after a 429 when the header is missing. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

function parseRetryAfter(res: Response): number {
  const raw = res.headers.get("retry-after");
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETRY_AFTER_SECONDS;
}

export async function postAniListGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const res = await fetch(ANILIST_GRAPHQL_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  // 429 must be distinguished from other failures. Note that on a 429 AniList
  // omits the X-RateLimit-* headers entirely, so only `retry-after` is usable.
  if (res.status === 429) {
    throw new AniListRateLimitError(parseRetryAfter(res));
  }

  if (!res.ok) {
    throw new Error(`AniList API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as AniListGraphQlEnvelope<T>;
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors[0]?.message ?? "AniList query failed");
  }

  if (json.data === undefined) {
    throw new Error("AniList response missing data");
  }

  return json.data;
}
