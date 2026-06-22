/**
 * Steam Web API client.
 * Covers all major player data endpoints.
 */

const STEAM_API_BASE = "https://api.steampowered.com";

function key(): string {
  const k = process.env.STEAM_API_KEY;
  if (!k) throw new Error("STEAM_API_KEY is not configured");
  return k;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;          // minutes total
  playtime_2weeks?: number;          // minutes in last 2 weeks
  img_icon_url: string;
  rtime_last_played?: number;        // unix timestamp
  has_community_visible_stats?: boolean;
  playtime_windows_forever?: number;
  playtime_mac_forever?: number;
  playtime_linux_forever?: number;
  playtime_deck_forever?: number;
}

export interface RecentlyPlayedGame {
  appid: number;
  name: string;
  playtime_2weeks: number;           // minutes
  playtime_forever: number;          // minutes
  img_icon_url: string;
  playtime_windows_forever?: number;
  playtime_mac_forever?: number;
  playtime_linux_forever?: number;
}

export interface PlayerAchievement {
  apiname: string;
  achieved: number;                  // 0 or 1
  unlocktime: number;                // unix timestamp (0 if locked)
  name?: string;                     // display name (from schema)
  description?: string;             // description (from schema)
}

export interface GameAchievementSchema {
  name: string;                      // api name (key)
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden?: number;
}

export interface PlayerBans {
  SteamId: string;
  CommunityBanned: boolean;
  VACBanned: boolean;
  NumberOfVACBans: number;
  DaysSinceLastBan: number;
  NumberOfGameBans: number;
  EconomyBan: string;
}

export interface SteamPlayerSummary {
  steamid: string;
  personaname: string;
  avatarfull: string;
  profileurl: string;
  personastate: number;              // 0=Offline, 1=Online, 2=Busy, 3=Away, 4=Snooze, 5=Looking to trade, 6=Looking to play
  communityvisibilitystate: number;  // 1=Private, 3=Public
  lastlogoff?: number;
  timecreated?: number;              // account creation unix timestamp
  loccountrycode?: string;
  realname?: string;
  primaryclanid?: string;
}

// ─── URL helpers ─────────────────────────────────────────────────────────────

export function getGameHeaderImageUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

export function getGameHeroImageUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`;
}

export function getGameCapsuleImageUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`;
}

export function getStorePage(appId: number): string {
  return `https://store.steampowered.com/app/${appId}`;
}

export function getGameIconUrl(appId: number, iconHash: string): string {
  if (!iconHash) return "";
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${iconHash}.jpg`;
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

export function getPersonaStateLabel(state: number): string {
  const states: Record<number, string> = {
    0: "Hors ligne",
    1: "En ligne",
    2: "Occupé",
    3: "Absent",
    4: "Somnolent",
    5: "Cherche à échanger",
    6: "Cherche à jouer",
  };
  return states[state] ?? "Inconnu";
}

// ─── Internal fetch helper ────────────────────────────────────────────────────

async function steamFetch<T>(
  path: string,
  params: Record<string, string>,
  useKey = true
): Promise<T | null> {
  const url = new URL(`${STEAM_API_BASE}/${path}`);
  if (useKey) url.searchParams.set("key", key());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

// ─── Player data ─────────────────────────────────────────────────────────────

/** Full public profile for one or more Steam IDs. */
export async function getPlayerSummaries(
  steamIds: string[]
): Promise<SteamPlayerSummary[]> {
  const data = await steamFetch<{
    response?: { players?: SteamPlayerSummary[] };
  }>("ISteamUser/GetPlayerSummaries/v2/", {
    steamids: steamIds.join(","),
  });
  return data?.response?.players ?? [];
}

/** All games owned by the user, with playtime and app metadata. */
export async function getOwnedGames(steamId: string): Promise<OwnedGame[]> {
  const data = await steamFetch<{
    response?: { games?: OwnedGame[]; game_count?: number };
  }>("IPlayerService/GetOwnedGames/v1/", {
    steamid: steamId,
    include_appinfo: "1",
    include_played_free_games: "1",
    include_extended_appinfo: "1",
  });
  return data?.response?.games ?? [];
}

/** Games played in the last 2 weeks (up to 20). */
export async function getRecentlyPlayedGames(
  steamId: string
): Promise<RecentlyPlayedGame[]> {
  const data = await steamFetch<{
    response?: { games?: RecentlyPlayedGame[] };
  }>("IPlayerService/GetRecentlyPlayedGames/v1/", {
    steamid: steamId,
    count: "20",
  });
  return data?.response?.games ?? [];
}

/** Current Steam level of the user. */
export async function getSteamLevel(steamId: string): Promise<number> {
  const data = await steamFetch<{
    response?: { player_level?: number };
  }>("IPlayerService/GetSteamLevel/v1/", { steamid: steamId });
  return data?.response?.player_level ?? 0;
}

/** Number of Steam friends. Returns -1 if the friends list is private. */
export async function getFriendCount(steamId: string): Promise<number> {
  const data = await steamFetch<{
    friendslist?: { friends?: unknown[] };
  }>("ISteamUser/GetFriendList/v1/", {
    steamid: steamId,
    relationship: "friend",
  });
  if (!data) return -1; // private profile
  return data?.friendslist?.friends?.length ?? 0;
}

/** VAC, community and game ban status for a player. */
export async function getPlayerBans(
  steamId: string
): Promise<PlayerBans | null> {
  const data = await steamFetch<{ players?: PlayerBans[] }>(
    "ISteamUser/GetPlayerBans/v1/",
    { steamids: steamId }
  );
  return data?.players?.[0] ?? null;
}

/** All achievements for a specific game, with unlock status and timestamps. */
export async function getPlayerAchievements(
  steamId: string,
  appId: number
): Promise<PlayerAchievement[]> {
  const data = await steamFetch<{
    playerstats?: {
      success?: boolean;
      achievements?: PlayerAchievement[];
    };
  }>("ISteamUserStats/GetPlayerAchievements/v1/", {
    steamid: steamId,
    appid: appId.toString(),
    l: "english",
  });
  if (!data?.playerstats?.success) return [];
  return data.playerstats.achievements ?? [];
}

/**
 * Achievement schema (display names, descriptions, icons) for a game.
 * Returns a map keyed by the achievement api name.
 */
export async function getGameAchievementSchema(
  appId: number
): Promise<Record<string, GameAchievementSchema>> {
  const data = await steamFetch<{
    game?: {
      availableGameStats?: { achievements?: GameAchievementSchema[] };
    };
  }>("ISteamUserStats/GetSchemaForGame/v2/", {
    appid: appId.toString(),
    l: "english",
  });
  const achievements =
    data?.game?.availableGameStats?.achievements ?? [];
  return Object.fromEntries(achievements.map((a) => [a.name, a]));
}

/**
 * Global achievement unlock percentages (rarity) for a game.
 * Returns a map: apiName → percentage (0–100).
 * Does not require an API key.
 */
export async function getGlobalAchievementPercentages(
  appId: number
): Promise<Record<string, number>> {
  const data = await steamFetch<{
    achievementpercentages?: {
      achievements?: Array<{ name: string; percent: number }>;
    };
  }>(
    "ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
    { gameid: appId.toString() },
    false // no API key for this endpoint
  );
  const stats = data?.achievementpercentages?.achievements ?? [];
  return Object.fromEntries(stats.map((s) => [s.name, s.percent]));
}

// ─── Steam Store API ──────────────────────────────────────────────────────────

export interface AppCategory {
  id: number;
  description: string;
}

export interface AppGenre {
  id: string;
  description: string;
}

export interface AppDetails {
  name: string;
  steam_appid: number;
  short_description?: string;
  developers?: string[];
  publishers?: string[];
  genres?: AppGenre[];
  categories?: AppCategory[];
  release_date?: { coming_soon: boolean; date: string };
  metacritic?: { score: number; url: string };
  is_free: boolean;
  price_overview?: {
    currency: string;
    initial: number;
    final: number;
    discount_percent: number;
    initial_formatted: string;
    final_formatted: string;
  };
  header_image?: string;
  background?: string;
  website?: string;
  platforms?: { windows: boolean; mac: boolean; linux: boolean };
  required_age?: number | string;
  supported_languages?: string;
  dlc?: number[];
  achievements?: { total: number };
  screenshots?: Array<{ id: number; path_thumbnail: string; path_full: string }>;
}

/**
 * Full game metadata from the Steam Store API (no API key required).
 * Returns null if the game is not found or the API is unavailable.
 */
export async function getAppDetails(appId: number): Promise<AppDetails | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=fr&l=french`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<
      string,
      { success: boolean; data?: AppDetails }
    >;
    const entry = data[appId.toString()];
    if (!entry?.success || !entry.data) return null;
    return entry.data;
  } catch {
    return null;
  }
}

// ─── Badges & XP ─────────────────────────────────────────────────────────────

export interface PlayerBadge {
  badgeid: number;
  level: number;
  completion_time: number;
  xp: number;
  scarcity: number;
  appid?: number;
  communityitemid?: string;
  border_color?: number;
}

export interface PlayerBadgesData {
  badges: PlayerBadge[];
  player_xp: number;
  player_level: number;
  player_xp_needed_to_level_up: number;
  player_xp_needed_current_level: number;
}

/** Player badges, total XP, and level progression. */
export async function getPlayerBadges(
  steamId: string
): Promise<PlayerBadgesData | null> {
  const data = await steamFetch<{ response?: PlayerBadgesData }>(
    "IPlayerService/GetBadges/v1/",
    { steamid: steamId }
  );
  return data?.response ?? null;
}

// ─── Badge asset info (Steam Economy API) ────────────────────────────────────

export interface BadgeAssetInfo {
  classid: string;
  name?: string;
  /** Hash — combine with getBadgeIconCdnUrl() to get full URL. */
  icon_url?: string;
  icon_url_large?: string;
  type?: string;
  tradable?: boolean;
  marketable?: boolean;
}

/** Convert a Steam Economy icon_url hash to a full CDN URL (96×96). */
export function getBadgeIconCdnUrl(iconUrlHash: string): string {
  return `https://cdn.cloudflare.steamstatic.com/economy/image/${iconUrlHash}/96fx96f`;
}

/**
 * Fetch Steam Economy asset class info for a list of badge communityitemids.
 * Uses appid=753 (Steam Community — trading cards, badges, emoticons, …).
 * Returns a map of classid → BadgeAssetInfo.
 */
export async function getBadgeAssetInfoBatch(
  communityItemIds: string[]
): Promise<Map<string, BadgeAssetInfo>> {
  const result = new Map<string, BadgeAssetInfo>();
  if (communityItemIds.length === 0) return result;

  const BATCH = 100;
  for (let i = 0; i < communityItemIds.length; i += BATCH) {
    const batch = communityItemIds.slice(i, i + BATCH);
    try {
      const url = new URL(`${STEAM_API_BASE}/ISteamEconomy/GetAssetClassInfo/v1/`);
      url.searchParams.set("key", key());
      url.searchParams.set("appid", "753");
      url.searchParams.set("language", "english");
      url.searchParams.set("class_count", batch.length.toString());
      batch.forEach((id, idx) => {
        url.searchParams.set(`classid${idx}`, id);
        url.searchParams.set(`instanceid${idx}`, "0");
      });

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          result?: Record<
            string,
            | {
                name?: string;
                icon_url?: string;
                icon_url_large?: string;
                type?: string;
                tradable?: string;
                marketable?: string;
              }
            | boolean
          >;
        };
        if (data.result) {
          for (const [classid, info] of Object.entries(data.result)) {
            if (classid === "success" || typeof info === "boolean") continue;
            result.set(classid, {
              classid,
              name: info.name,
              icon_url: info.icon_url,
              icon_url_large: info.icon_url_large,
              type: info.type,
              tradable: info.tradable === "1",
              marketable: info.marketable === "1",
            });
          }
        }
      }
    } catch {
      // Non-critical
    }
    if (i + BATCH < communityItemIds.length) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return result;
}

// ─── Per-game user stats ──────────────────────────────────────────────────────

export interface GameStatEntry {
  name: string;
  value: number;
}

export interface GameStatsData {
  steamID: string;
  gameName: string;
  stats?: GameStatEntry[];
}

/**
 * Per-game user stats (kills, deaths, rounds, etc.).
 * Returns null if unavailable, private, or the game has no stats schema.
 */
export async function getUserStatsForGame(
  steamId: string,
  appId: number
): Promise<GameStatsData | null> {
  const data = await steamFetch<{ playerstats?: GameStatsData }>(
    "ISteamUserStats/GetUserStatsForGame/v2/",
    { steamid: steamId, appid: appId.toString() }
  );
  return data?.playerstats ?? null;
}

// ─── Wishlist ─────────────────────────────────────────────────────────────────

export interface WishlistItem {
  appid: number;
  priority: number;
  added: number; // unix timestamp
}

/** Player wishlist. Returns empty array if the wishlist is private or not found. */
export async function getWishlist(steamId: string): Promise<WishlistItem[]> {
  // Primary: authenticated Steam Web API (works regardless of privacy setting)
  try {
    const data = await steamFetch<{
      response?: {
        items?: Array<{ appid: number; priority: number; date_added: number }>;
      };
    }>("IWishlistService/GetWishlist/v1/", { steamid: steamId });
    if (data?.response?.items && data.response.items.length > 0) {
      return data.response.items.map((item) => ({
        appid: item.appid,
        priority: item.priority ?? 0,
        added: item.date_added ?? 0,
      }));
    }
  } catch {
    // Fall through to Store API
  }

  // Fallback: Store API (public wishlists only)
  const all: WishlistItem[] = [];
  try {
    let page = 0;
    while (true) {
      const url = `https://store.steampowered.com/wishlist/profiles/${steamId}/wishlistdata/?p=${page}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "User-Agent": "SteamTrackerNotion/1.0" },
      });
      if (!res.ok) break;
      const raw = (await res.json()) as Record<string, unknown>;
      if (!raw || typeof raw !== "object") break;
      const entries = Object.entries(raw).filter(([k]) => /^\d+$/.test(k));
      if (entries.length === 0) break;
      for (const [appid, item] of entries) {
        const obj = item as { priority?: number; added?: number };
        all.push({
          appid: parseInt(appid, 10),
          priority: obj.priority ?? 0,
          added: obj.added ?? 0,
        });
      }
      if (entries.length < 100) break;
      page++;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch {
    // Wishlist may be private — not a hard failure
  }
  return all;
}

// ─── Friends ─────────────────────────────────────────────────────────────────

export interface SteamFriend {
  steamid: string;
  relationship: string;
  friend_since: number; // unix timestamp
}

/** Full friend list for a player. Returns empty array if the friends list is private. */
export async function getFriendList(steamId: string): Promise<SteamFriend[]> {
  const data = await steamFetch<{
    friendslist?: { friends?: SteamFriend[] };
  }>("ISteamUser/GetFriendList/v1/", {
    steamid: steamId,
    relationship: "friend",
  });
  return data?.friendslist?.friends ?? [];
}

// ─── Workshop ─────────────────────────────────────────────────────────────────

export interface WorkshopItem {
  publishedfileid: string;
  creator: string;
  creator_appid: number;
  consumer_appid: number;
  title: string;
  description?: string;
  preview_url?: string;
  time_created?: number;
  time_updated?: number;
  subscriptions?: number;
  favorited?: number;
  lifetime_subscriptions?: number;
  lifetime_favorited?: number;
  views?: number;
  tags?: Array<{ tag: string; display_name?: string }>;
}

/** Workshop items published by the user. Returns empty array if none or unavailable. */
export async function getWorkshopItems(
  steamId: string
): Promise<WorkshopItem[]> {
  const data = await steamFetch<{
    response?: {
      publishedfiledetails?: WorkshopItem[];
      total?: number;
    };
  }>("IPublishedFileService/GetUserFiles/v1/", {
    steamid: steamId,
    numperpage: "100",
    type: "0",
    return_tags: "1",
    return_previews: "1",
  });
  return data?.response?.publishedfiledetails ?? [];
}

// ─── Bulk Store API ───────────────────────────────────────────────────────────

/**
 * Fetch Store API metadata for many appIds in batches of 50.
 * No API key required. Returns a Map of appId → AppDetails.
 */
export async function getBulkAppDetails(
  appIds: number[]
): Promise<Map<number, AppDetails>> {
  const result = new Map<number, AppDetails>();
  if (appIds.length === 0) return result;

  const BATCH_SIZE = 50;
  for (let i = 0; i < appIds.length; i += BATCH_SIZE) {
    const batch = appIds.slice(i, i + BATCH_SIZE);
    const url =
      `https://store.steampowered.com/api/appdetails?appids=${batch.join(",")}&cc=fr&l=french`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as Record<
          string,
          { success: boolean; data?: AppDetails }
        >;
        for (const appId of batch) {
          const entry = data[appId.toString()];
          if (entry?.success && entry.data) result.set(appId, entry.data);
        }
      }
    } catch {
      // Non-critical: skip this batch and continue
    }
    if (i + BATCH_SIZE < appIds.length) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }
  return result;
}

// ─── Trading cards ────────────────────────────────────────────────────────────

export interface TradingCard {
  classid: string;
  /** Short display name, e.g. "Joe Musashi". */
  name: string;
  /** Economy image hash — use with: https://cdn.cloudflare.steamstatic.com/economy/image/{hash} */
  icon_url: string;
  market_hash_name: string;
}

/**
 * Fetch all trading cards available for a game via the Steam Community Market.
 * Uses the public market search render endpoint (no API key required).
 * Returns an empty array if the game has no trading cards or the request fails.
 */
export async function getTradingCardsForApp(appId: number): Promise<TradingCard[]> {
  try {
    // category_753_Game[]=tag_app_{appId}  selects cards for this game
    // category_753_item_class[]=tag_item_class_2  filters to Trading Cards only
    const url =
      `https://steamcommunity.com/market/search/render/` +
      `?appid=753` +
      `&category_753_Game%5B%5D=tag_app_${appId}` +
      `&category_753_item_class%5B%5D=tag_item_class_2` +
      `&count=100&format=json&l=english`;

    const res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "SteamTrackerNotion/1.0" },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      success: boolean;
      results?: Array<{
        name: string;
        hash_name?: string;
        asset_description?: {
          classid: string;
          icon_url: string;
          name?: string;
          market_name?: string;
          market_hash_name?: string;
        };
      }>;
    };

    if (!data.success || !data.results?.length) return [];

    return data.results
      .filter((r) => r.asset_description?.classid && r.asset_description.icon_url)
      .map((r) => ({
        classid: r.asset_description!.classid,
        name:
          r.asset_description!.market_name ??
          r.asset_description!.name ??
          r.name,
        icon_url: r.asset_description!.icon_url,
        market_hash_name:
          r.asset_description!.market_hash_name ??
          r.hash_name ??
          r.name,
      }));
  } catch {
    return [];
  }
}

// ─── Additional image URL helpers ─────────────────────────────────────────────

/** Workshop item URL on Steam Community. */
export function getWorkshopItemUrl(publishedfileid: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${publishedfileid}`;
}

/** Portrait capsule used in Steam Library grid view (600×900). */
export function getGamePortraitImageUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`;
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export interface InventoryTag {
  category: string;
  internal_name: string;
  localized_category_name: string;
  localized_tag_name: string;
  color?: string;
}

export interface InventoryItem {
  assetid: string;
  classid: string;
  name: string;
  market_name: string;
  type: string;
  /** Full CDN URL for the item icon (96×96). */
  icon_url: string;
  tradable: boolean;
  marketable: boolean;
  commodity: boolean;
  tags?: InventoryTag[];
}

/**
 * Steam Community inventory (app 753 / context 6 = community items:
 * trading cards, backgrounds, emoticons, profile frames, …).
 * Returns up to 5000 items. Returns empty array if private or unavailable.
 */
export async function getInventoryItems(steamId: string): Promise<InventoryItem[]> {
  const allItems: InventoryItem[] = [];
  let lastAssetId: string | undefined;

  try {
    while (true) {
      const params = new URLSearchParams({ l: "english", count: "5000" });
      if (lastAssetId) params.set("start_assetid", lastAssetId);
      const url = `https://steamcommunity.com/inventory/${steamId}/753/6?${params.toString()}`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "User-Agent": "SteamTrackerNotion/1.0" },
      });
      if (!res.ok) break;

      const data = (await res.json()) as {
        success?: number | boolean;
        assets?: Array<{ assetid: string; classid: string; instanceid: string }>;
        descriptions?: Array<{
          classid: string;
          instanceid: string;
          name: string;
          market_name: string;
          type: string;
          icon_url: string;
          tradable: number;
          marketable: number;
          commodity: number;
          tags?: InventoryTag[];
        }>;
        more_items?: number;
        last_assetid?: string;
        total_inventory_count?: number;
      };

      // success can be 1, true, or absent; false/0 means private or error
      if (data.success === false || data.success === 0) break;
      if (!data.assets?.length || !data.descriptions?.length) break;

      // Build lookup: "classid_instanceid" → description
      const descMap = new Map(
        data.descriptions.map((d) => [`${d.classid}_${d.instanceid}`, d])
      );

      for (const asset of data.assets) {
        const desc = descMap.get(`${asset.classid}_${asset.instanceid}`);
        if (!desc) continue;
        allItems.push({
          assetid: asset.assetid,
          classid: asset.classid,
          name: desc.name,
          market_name: desc.market_name,
          type: desc.type,
          icon_url: `https://cdn.cloudflare.steamstatic.com/economy/image/${desc.icon_url}/96fx96f`,
          tradable: desc.tradable === 1,
          marketable: desc.marketable === 1,
          commodity: desc.commodity === 1,
          tags: desc.tags,
        });
      }

      if (!data.more_items || !data.last_assetid) break;
      lastAssetId = data.last_assetid;
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch {
    return allItems;
  }
  return allItems;
}
