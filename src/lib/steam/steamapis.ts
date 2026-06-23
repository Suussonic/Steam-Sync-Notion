/**
 * steamapis.com v2 API client.
 *
 * Requires the STEAMAPIS_KEY environment variable.
 * All endpoints use the `x-api-key` request header.
 * Base URL: https://api.steamapis.com
 *
 * This module enriches data beyond what the free official Steam Web API provides:
 *   • controllerSupport  — "full" | "partial" | null
 *   • recommendations    — total positive recommendation count
 *   • website            — official game website URL
 *   • categories         — Steam feature categories (online multi-player, co-op, …)
 *   • disconnectedMinutes in recently-played entries
 *   • groups             — Steam groups a user belongs to
 *   • stats              — per-game in-game statistics (kills, deaths, …)
 */

const STEAMAPIS_BASE = "https://api.steamapis.com";

/** Returns true when the STEAMAPIS_KEY env var is set. */
export function hasSteamapisKey(): boolean {
  return !!process.env.STEAMAPIS_KEY;
}

function key(): string {
  const k = process.env.STEAMAPIS_KEY;
  if (!k) throw new Error("STEAMAPIS_KEY is not configured");
  return k;
}

async function steamapisFetch<T>(path: string): Promise<T | null> {
  const url = `${STEAMAPIS_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { "x-api-key": key() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success: boolean;
      result?: T;
      results?: T;
    };
    if (!data.success) return null;
    return (data.result ?? data.results ?? null) as T;
  } catch {
    return null;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SteamapisUserProfile {
  steamID: string;
  nickname: string;
  avatar: {
    small: string;
    medium: string;
    large: string;
    hash: string;
  };
  url: string;
  visible: boolean;
  personaState: number;
  personaStateFlags: number;
  allowsComments: boolean;
  lastLogOffTimestamp: number;
  createdTimestamp: number;
  primaryGroupID: string;
  countryCode: string;
}

export interface SteamapisBadgesData {
  badges: Array<{
    badgeid: number;
    appid?: number;
    level: number;
    completion_time: number;
    xp: number;
    scarcity: number;
    communityitemid?: string;
    border_color?: number;
  }>;
  player_xp: number;
  player_level: number;
  player_xp_needed_to_level_up: number;
  player_xp_needed_current_level: number;
}

export interface SteamapisBanStatus {
  SteamId: string;
  CommunityBanned: boolean;
  VACBanned: boolean;
  NumberOfVACBans: number;
  DaysSinceLastBan: number;
  NumberOfGameBans: number;
  EconomyBan: string;
}

export interface SteamapisFriend {
  steamID: string;
  friendedTimestamp: number;
  relationship: string;
}

export interface SteamapisAchievement {
  name: string;
  unlocked: boolean;
  unlockedTimestamp: number;
}

export interface SteamapisAchievementsResult {
  steamID: string;
  game: string;
  achievements: SteamapisAchievement[];
}

export interface SteamapisStat {
  name: string;
  value: number;
}

export interface SteamapisStatsResult {
  steamID: string;
  game: string;
  achievements: Array<{ name: string; unlocked: boolean }>;
  stats: SteamapisStat[];
}

export interface SteamapisRecentlyPlayedEntry {
  game: {
    id: number;
    name: string;
    icon: string;
  };
  minutes: number;
  recentMinutes: number;
  windowsMinutes: number;
  macMinutes: number;
  linuxMinutes: number;
  disconnectedMinutes: number;
}

export interface SteamapisAppDetails {
  _id: string;
  appId: number;
  name: string | null;
  type: string | null;
  requiredAge: number;
  isFree: boolean;
  shortDescription: string | null;
  developers: string[];
  publishers: string[];
  headerImage: string | null;
  capsuleImage: string | null;
  background: string | null;
  genres: Array<{ id: string; description: string }>;
  categories: Array<{ id: number; description: string }>;
  platforms: { windows: boolean; mac: boolean; linux: boolean };
  metacritic: { score: number | null; url: string | null } | null;
  recommendations: { total: number } | null;
  achievements: { total: number } | null;
  releaseDate: { comingSoon: boolean; date: string | null } | null;
  website: string | null;
  controllerSupport: string | null;
  priceOverview: {
    currency: string | null;
    initial: number | null;
    final: number | null;
    discountPercent: number;
    initialFormatted: string | null;
    finalFormatted: string | null;
  } | null;
  screenshots: Array<{ id: number; pathThumbnail: string; pathFull: string }>;
  movies: Array<{
    id: number;
    name: string;
    thumbnail: string;
    highlight: boolean;
  }>;
  pcRequirements: { minimum: string | null; recommended: string | null } | null;
  supportInfo: { url: string | null; email: string | null } | null;
  ratings: Record<string, unknown> | null;
  dlc: number[];
}

// ─── User endpoints ───────────────────────────────────────────────────────────

/** User profile via steamapis v2. */
export async function getSteamapisUser(
  steamId: string
): Promise<SteamapisUserProfile | null> {
  return steamapisFetch<SteamapisUserProfile>(
    `/v2/steam/users/${encodeURIComponent(steamId)}`
  );
}

/** Steam groups the user belongs to. Returns array of group IDs (strings). */
export async function getSteamapisGroups(steamId: string): Promise<string[]> {
  const result = await steamapisFetch<string[]>(
    `/v2/steam/users/${encodeURIComponent(steamId)}/groups`
  );
  return result ?? [];
}

/** User's friends list via steamapis v2 (includes friendedTimestamp). */
export async function getSteamapisFriends(
  steamId: string
): Promise<SteamapisFriend[]> {
  const result = await steamapisFetch<SteamapisFriend[]>(
    `/v2/steam/users/${encodeURIComponent(steamId)}/friends`
  );
  return result ?? [];
}

/** User's achievements for a specific game via steamapis v2. */
export async function getSteamapisAchievements(
  steamId: string,
  appId: number
): Promise<SteamapisAchievementsResult | null> {
  return steamapisFetch<SteamapisAchievementsResult>(
    `/v2/steam/users/${encodeURIComponent(steamId)}/achievements/${appId}`
  );
}

/**
 * User's in-game stats AND unlocked achievements for a specific game.
 * The stats object contains all per-game counters (kills, deaths, rounds, etc.).
 */
export async function getSteamapisStats(
  steamId: string,
  appId: number
): Promise<SteamapisStatsResult | null> {
  return steamapisFetch<SteamapisStatsResult>(
    `/v2/steam/users/${encodeURIComponent(steamId)}/stats/${appId}`
  );
}

/**
 * Recently played games via steamapis v2.
 * Includes `disconnectedMinutes` not available in the official API.
 */
export async function getSteamapisRecentlyPlayed(
  steamId: string
): Promise<SteamapisRecentlyPlayedEntry[]> {
  const result = await steamapisFetch<SteamapisRecentlyPlayedEntry[]>(
    `/v2/steam/users/${encodeURIComponent(steamId)}/recently-played`
  );
  return result ?? [];
}

/** Resolve a Steam vanity URL to a SteamID64. */
export async function resolveVanityUrl(vanityUrl: string): Promise<string | null> {
  const result = await steamapisFetch<{ steamID: string }>(
    `/v2/steam/users/vanity/${encodeURIComponent(vanityUrl)}`
  );
  return result?.steamID ?? null;
}

// ─── App endpoints ────────────────────────────────────────────────────────────

/**
 * Richer app details via steamapis v2.
 * Provides `controllerSupport`, `website`, `recommendations.total`,
 * `categories`, `ratings`, `pcRequirements`, etc. beyond the Steam Store API.
 */
export async function getSteamapisAppDetails(
  appId: number
): Promise<SteamapisAppDetails | null> {
  return steamapisFetch<SteamapisAppDetails>(`/v2/steam/apps/${appId}`);
}

/**
 * Fetch steamapis app details for multiple appIds in small batches.
 * Only usable when STEAMAPIS_KEY is set.
 * Returns a Map of appId → SteamapisAppDetails.
 */
export async function getBulkSteamapisAppDetails(
  appIds: number[]
): Promise<Map<number, SteamapisAppDetails>> {
  const result = new Map<number, SteamapisAppDetails>();
  if (appIds.length === 0 || !hasSteamapisKey()) return result;

  const BATCH = 10;
  for (let i = 0; i < appIds.length; i += BATCH) {
    const batch = appIds.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((id) => getSteamapisAppDetails(id))
    );
    batch.forEach((id, idx) => {
      const r = results[idx];
      if (r) result.set(id, r);
    });
    if (i + BATCH < appIds.length) {
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return result;
}
