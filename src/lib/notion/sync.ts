/**
 * Steam → Notion synchronisation engine.
 *
 * Creates (or updates) the following structure in the user's Notion workspace:
 *
 *   🎮 Steam Sync Notion            ← main page
 *   ├── 👤 Profil Steam             ← page with stats blocks
 *   ├── 📚 Bibliothèque Steam       ← database: one row per owned game
 *   ├── 🏆 Succès                   ← database: achievements (recent games)
 *   ├── 📋 Liste de souhaits        ← database: wishlist
 *   ├── 👥 Amis                     ← database: friends list
 *   ├── 🏅 Badges Steam             ← database: badges + trading cards
 *   ├── 🎒 Inventaire Steam         ← database: community inventory items
 *   ├── 🔧 Workshop Steam           ← database: published workshop items
 *   ├── 👥 Groupes Steam            ← database: Steam groups membership
 *   └── 📊 Statistiques             ← database: per-game in-game stats
 */

import { Client } from "@notionhq/client";
import type {
  BlockObjectRequest,
  CreatePageParameters,
  PageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";

import {
  getOwnedGames,
  getRecentlyPlayedGames,
  getSteamLevel,
  getFriendCount,
  getPlayerBans,
  getPlayerAchievements,
  getGameAchievementSchema,
  getGlobalAchievementPercentages,
  getPlayerBadges,
  getBulkAppDetails,
  getFriendList,
  getWishlist,
  getWorkshopItems,
  getWorkshopItemUrl,
  getInventoryItems,
  getPlayerSummaries,
  getPersonaStateLabel,
  getGameHeroImageUrl,
  getGameHeaderImageUrl,
  getGameCapsuleImageUrl,
  getStorePage,
  getGameIconUrl,
  getBadgeAssetInfoBatch,
  getBadgeIconCdnUrl,
  getTradingCardsForApp,
  minutesToHours,
  getPlayerGroups,
  getCurrentPlayerCount,
  getUserStatsForGame,
  type OwnedGame,
  type RecentlyPlayedGame,
  type AppDetails,
  type PlayerBadge,
  type PlayerBadgesData,
  type SteamFriend,
  type WishlistItem,
  type InventoryItem,
  type WorkshopItem,
  type SteamPlayerSummary,
  type BadgeAssetInfo,
  type TradingCard,
  type GameStatEntry,
} from "@/lib/steam/api";

import {
  hasSteamapisKey,
  getBulkSteamapisAppDetails,
  getSteamapisGroups,
  getSteamapisStats,
  type SteamapisAppDetails,
} from "@/lib/steam/steamapis";

import type { SteamProfile } from "@/lib/steam/openid";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SyncOptions {
  notionToken: string;
  steamId: string;
  steamProfile: SteamProfile;
  /** Page IDs persisted from a previous sync (for fast update path). */
  existingPageId?: string;
  existingLibraryDbId?: string;
  existingAchievementsDbId?: string;
  existingProfilePageId?: string;
  existingWishlistDbId?: string;
  existingFriendsDbId?: string;
  existingBadgesDbId?: string;
  existingInventoryDbId?: string;
  existingWorkshopDbId?: string;
  existingGroupsDbId?: string;
  existingStatsDbId?: string;
  onProgress?: (message: string) => void;
}

export interface SyncResult {
  success: boolean;
  pageId?: string;
  pageUrl?: string;
  libraryDbId?: string;
  achievementsDbId?: string;
  wishlistDbId?: string;
  friendsDbId?: string;
  badgesDbId?: string;
  inventoryDbId?: string;
  workshopDbId?: string;
  groupsDbId?: string;
  statsDbId?: string;
  profilePageId?: string;
  gamesCount?: number;
  achievementsCount?: number;
  wishlistCount?: number;
  friendsCount?: number;
  badgesCount?: number;
  inventoryCount?: number;
  workshopCount?: number;
  groupsCount?: number;
  statsCount?: number;
  error?: string;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function syncSteamToNotion(
  options: SyncOptions
): Promise<SyncResult> {
  const {
    notionToken,
    steamId,
    steamProfile,
    existingPageId,
    existingLibraryDbId,
    existingAchievementsDbId,
    existingProfilePageId,
    existingWishlistDbId,
    existingFriendsDbId,
    existingBadgesDbId,
    existingInventoryDbId,
    existingWorkshopDbId,
    existingGroupsDbId,
    existingStatsDbId,
    onProgress,
  } = options;

  const notion = new Client({ auth: notionToken });
  const report = (msg: string) => onProgress?.(msg);

  try {
    // ── Step 1: Core Steam data + wishlist (parallel) ──────────────────────
    report("Récupération des données Steam...");
    const [ownedGames, recentGames, steamLevel, friendCount, bans, wishlist] =
      await Promise.all([
        getOwnedGames(steamId),
        getRecentlyPlayedGames(steamId),
        getSteamLevel(steamId),
        getFriendCount(steamId),
        getPlayerBans(steamId),
        getWishlist(steamId),
      ]);

    report(
      `${ownedGames.length} jeux · ${recentGames.length} récents · Niveau ${steamLevel}`
    );

    const recentByAppId = new Map(recentGames.map((g) => [g.appid, g]));

    // ── Step 2: Bulk Store API for ALL owned games + wishlist ──────────────
    report("Récupération des métadonnées Store (tous les jeux)...");
    const allAppIds = [
      ...new Set([
        ...ownedGames.map((g) => g.appid),
        ...wishlist.map((w) => w.appid),
      ]),
    ];
    const storeDetailsMap = await getBulkAppDetails(allAppIds);
    report(`Métadonnées récupérées pour ${storeDetailsMap.size} jeux.`);

    // ── Step 2b: Enriched app details via steamapis.com (optional) ─────────
    // Cover games played in the last 30 days (not just Steam's 14-day window)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    const steamapisAppIds = hasSteamapisKey()
      ? [
          ...new Set([
            ...recentGames.map((g) => g.appid),
            ...ownedGames
              .filter((g) => g.rtime_last_played && g.rtime_last_played > thirtyDaysAgo)
              .map((g) => g.appid),
          ]),
        ].slice(0, 50)
      : [];
    const steamapisDetailsMap =
      steamapisAppIds.length > 0
        ? await getBulkSteamapisAppDetails(steamapisAppIds)
        : new Map<number, SteamapisAppDetails>();
    if (hasSteamapisKey() && steamapisDetailsMap.size > 0) {
      report(`Données enrichies steamapis.com pour ${steamapisDetailsMap.size} jeux.`);
    }

    // ── Step 2c: Current player counts for recently played games ──────────
    const playerCountMap = new Map<number, number>();
    if (recentGames.length > 0) {
      report("Récupération du nombre de joueurs actuels...");
      const counts = await Promise.all(
        recentGames.map((g) => getCurrentPlayerCount(g.appid).catch(() => 0))
      );
      recentGames.forEach((g, i) => {
        if (counts[i] > 0) playerCountMap.set(g.appid, counts[i]);
      });
    }

    // ── Step 3: Achievements for top 50 played games with stats ───────────
    const gamesWithStats = ownedGames
      .filter((g) => g.has_community_visible_stats && g.playtime_forever > 0)
      .sort((a, b) => (b.rtime_last_played ?? 0) - (a.rtime_last_played ?? 0))
      .slice(0, 50);

    report(`Récupération des succès pour ${gamesWithStats.length} jeux...`);
    const achievementsMap = await fetchAchievementsForGames(
      steamId,
      gamesWithStats,
      (msg) => report(msg)
    );

    // ── Step 4: Badges, friends, groups, workshop (parallel) ─────────────
    report("Récupération badges, amis, groupes, workshop...");
    const [playerBadges, rawFriends, workshopItems, groups] =
      await Promise.all([
        getPlayerBadges(steamId),
        getFriendList(steamId),
        getWorkshopItems(steamId),
        hasSteamapisKey()
          ? getSteamapisGroups(steamId)
          : getPlayerGroups(steamId),
      ]);

    // ── Step 4b: Inventory (separate — has its own pagination + rate limit) ─
    report("Récupération de l'inventaire Steam...");
    const inventoryItems = await getInventoryItems(steamId);
    if (inventoryItems.length > 0) {
      report(`${inventoryItems.length} objet(s) trouvé(s) dans l'inventaire.`);
    } else {
      report("Inventaire vide ou privé — ignoré.");
    }

    // ── Step 4b: In-game stats for recently played games ──────────────────
    const statsData: Array<{
      gameName: string;
      appId: number;
      stats: GameStatEntry[];
    }> = [];
    const recentWithStats = recentGames.filter(
      (g) => g.has_community_visible_stats
    );
    if (recentWithStats.length > 0) {
      report(
        `Récupération des statistiques in-game pour ${recentWithStats.length} jeux...`
      );
      await batchProcess(
        recentWithStats.slice(0, 20),
        3,
        600,
        async (g) => {
          try {
            const data = await getUserStatsForGame(steamId, g.appid);
            if (data?.stats && data.stats.length > 0) {
              statsData.push({
                gameName: data.gameName,
                appId: g.appid,
                stats: data.stats,
              });
            }
          } catch {
            // Non-critical — stats may be private or unavailable
          }
        }
      );
      if (statsData.length > 0) {
        report(`Statistiques récupérées pour ${statsData.length} jeux.`);
      }
    }

    if (groups.length > 0) report(`${groups.length} groupes Steam récupérés.`);

    // Enrich up to 200 friends with profile summaries
    const friends = await enrichFriends(rawFriends.slice(0, 200));
    if (friends.length > 0) report(`${friends.length} amis récupérés.`);

    // ── Step 5: Notion scaffolding ─────────────────────────────────────────
    report("Préparation de la structure Notion...");
    const mainPage = await findOrCreateMainPage(notion, existingPageId);

    const [libraryDbId, achievementsDbId, wishlistDbId, friendsDbId, badgesDbId, inventoryDbId, workshopDbId, groupsDbId, statsDbId] =
      await Promise.all([
        findOrCreateDatabase(
          notion,
          mainPage.id,
          existingLibraryDbId,
          "Bibliothèque Steam",
          buildLibraryDbSchema()
        ),
        findOrCreateDatabase(
          notion,
          mainPage.id,
          existingAchievementsDbId,
          "Succès",
          buildAchievementsDbSchema()
        ),
        findOrCreateDatabase(
          notion,
          mainPage.id,
          existingWishlistDbId,
          "Liste de souhaits",
          buildWishlistDbSchema()
        ),
        findOrCreateDatabase(
          notion,
          mainPage.id,
          existingFriendsDbId,
          "Amis",
          buildFriendsDbSchema()
        ),
        findOrCreateDatabase(
          notion,
          mainPage.id,
          existingBadgesDbId,
          "Badges Steam",
          buildBadgesDbSchema()
        ),
        findOrCreateDatabase(
          notion,
          mainPage.id,
          existingInventoryDbId,
          "Inventaire Steam",
          buildInventoryDbSchema()
        ),
        findOrCreateDatabase(
          notion,
          mainPage.id,
          existingWorkshopDbId,
          "Workshop Steam",
          buildWorkshopDbSchema()
        ),
        findOrCreateDatabase(
          notion,
          mainPage.id,
          existingGroupsDbId,
          "Groupes Steam",
          buildGroupsDbSchema()
        ),
        findOrCreateDatabase(
          notion,
          mainPage.id,
          existingStatsDbId,
          "Statistiques",
          buildStatsDbSchema()
        ),
      ]);

    // ── Step 6: Sync library ───────────────────────────────────────────────
    report("Synchronisation de la bibliothèque...");
    const gamesCount = await syncGames(
      notion,
      libraryDbId,
      ownedGames,
      recentByAppId,
      achievementsMap,
      storeDetailsMap,
      playerCountMap,
      steamapisDetailsMap,
      (msg) => report(msg)
    );

    // ── Step 7: Sync achievements ──────────────────────────────────────────
    report("Synchronisation des succès...");
    const achievementsCount = await syncAchievements(
      notion,
      achievementsDbId,
      achievementsMap,
      (msg) => report(msg)
    );

    // ── Step 8: Sync wishlist ──────────────────────────────────────────────
    let wishlistCount = 0;
    if (wishlist.length > 0) {
      report(
        `Synchronisation de la liste de souhaits (${wishlist.length} jeux)...`
      );
      wishlistCount = await syncWishlist(
        notion,
        wishlistDbId,
        wishlist,
        storeDetailsMap,
        (msg) => report(msg)
      );
    }

    // ── Step 9: Sync friends ───────────────────────────────────────────────
    let friendsCount = 0;
    if (friends.length > 0) {
      report(`Synchronisation des amis (${friends.length})...`);
      friendsCount = await syncFriends(
        notion,
        friendsDbId,
        friends,
        (msg) => report(msg)
      );
    }

    // ── Step 10: Sync badges ───────────────────────────────────────────────
    let badgesCount = 0;
    if (playerBadges && playerBadges.badges.length > 0) {
      report(`Synchronisation des badges (${playerBadges.badges.length})...`);
      // Build appId → game name and icon maps for badge labeling
      const gameNameMap = new Map<number, string>([
        ...ownedGames.map((g): [number, string] => [g.appid, g.name]),
      ]);
      const gameIconMap = new Map<number, string>(
        ownedGames
          .filter((g) => !!g.img_icon_url)
          .map((g) => [g.appid, g.img_icon_url])
      );
      badgesCount = await syncBadges(
        notion,
        badgesDbId,
        playerBadges.badges,
        gameNameMap,
        gameIconMap,
        inventoryItems,
        (msg) => report(msg)
      );
    }

    // ── Step 11: Sync inventory ────────────────────────────────────────────
    let inventoryCount = 0;
    if (inventoryItems.length > 0) {
      report(`Synchronisation de l'inventaire (${inventoryItems.length} objets)...`);
      inventoryCount = await syncInventory(
        notion,
        inventoryDbId,
        inventoryItems,
        (msg) => report(msg)
      );
    }

    // ── Step 12: Sync workshop ─────────────────────────────────────────────
    let workshopSyncCount = 0;
    if (workshopItems.length > 0) {
      report(`Synchronisation du Workshop (${workshopItems.length} éléments)...`);
      workshopSyncCount = await syncWorkshop(
        notion,
        workshopDbId,
        workshopItems,
        (msg) => report(msg)
      );
    }

    // ── Step 14: Sync groups ───────────────────────────────────────────────
    let groupsCount = 0;
    if (groups.length > 0) {
      report(`Synchronisation des groupes Steam (${groups.length})...`);
      groupsCount = await syncGroups(notion, groupsDbId, groups, (msg) =>
        report(msg)
      );
    }

    // ── Step 15: Sync in-game stats ────────────────────────────────────────
    let statsCount = 0;
    if (statsData.length > 0) {
      report(`Synchronisation des statistiques (${statsData.length} jeux)...`);
      statsCount = await syncStats(
        notion,
        statsDbId,
        statsData,
        (msg) => report(msg)
      );
    }

    // ── Step 13: Profile page ──────────────────────────────────────────────
    report("Mise à jour du profil...");
    const profilePageId = await findOrCreateProfilePage(
      notion,
      mainPage.id,
      existingProfilePageId
    );
    await updateProfilePage(notion, profilePageId, {
      profile: steamProfile,
      steamLevel,
      friendCount,
      bans,
      ownedGames,
      recentGames,
      playerBadges,
      wishlistCount: wishlist.length,
      workshopCount: workshopItems.length,
      groupsCount: groups.length,
    });

    report(
      `Terminé ! ${gamesCount} jeux · ${achievementsCount} succès · ${wishlistCount} souhaits · ${friendsCount} amis · ${badgesCount} badges · ${inventoryCount} objets · ${workshopSyncCount} workshop · ${groupsCount} groupes · ${statsCount} stats`
    );

    return {
      success: true,
      pageId: mainPage.id,
      pageUrl: mainPage.url,
      libraryDbId,
      achievementsDbId,
      wishlistDbId,
      friendsDbId,
      badgesDbId,
      inventoryDbId,
      workshopDbId,
      groupsDbId,
      statsDbId,
      profilePageId,
      gamesCount,
      achievementsCount,
      wishlistCount,
      friendsCount,
      badgesCount,
      inventoryCount,
      workshopCount: workshopSyncCount,
      groupsCount,
      statsCount,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erreur inconnue lors du sync";
    return { success: false, error: message };
  }
}

// ─── Page / database scaffolding ─────────────────────────────────────────────

async function findOrCreateMainPage(
  notion: Client,
  existingId?: string
): Promise<{ id: string; url: string }> {
  // Try stored ID first
  if (existingId) {
    try {
      const page = (await notion.pages.retrieve({
        page_id: existingId,
      })) as PageObjectResponse;
      if (!page.archived) return { id: page.id, url: page.url };
    } catch {
      // Page not found or inaccessible — fall through
    }
  }

  // Search for an existing "Steam Sync Notion" page
  const search = await notion.search({
    query: "Steam Sync Notion",
    filter: { property: "object", value: "page" },
  });
  for (const result of search.results) {
    if (result.object !== "page") continue;
    const p = result as PageObjectResponse;
    if (p.archived) continue;
    const titleProp = Object.values(p.properties).find(
      (prop) => prop.type === "title"
    );
    if (titleProp?.type === "title") {
      const text = titleProp.title.map((t) => t.plain_text).join("");
      // match with or without legacy emoji prefix
      if (text.includes("Steam Sync Notion")) {
        return { id: p.id, url: p.url };
      }
    }
  }

  // Create the page — try workspace level, fall back to first accessible page
  const pageParams = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parent: { type: "workspace", workspace: true } as any,
    properties: {
      title: {
        title: [{ type: "text", text: { content: "Steam Sync Notion" } }],
      },
    },
  } satisfies Omit<CreatePageParameters, "parent"> & { parent: unknown };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await notion.pages.create(pageParams as any)) as PageObjectResponse;
    return { id: page.id, url: page.url };
  } catch {
    // Not authorized to create at workspace level — use first accessible page
    const fallback = await notion.search({
      filter: { property: "object", value: "page" },
    });
    const parent = fallback.results.find(
      (r) => r.object === "page" && !(r as PageObjectResponse).archived
    ) as PageObjectResponse | undefined;

    if (!parent) {
      throw new Error(
        "Aucune page Notion accessible. Lors de la connexion Notion, accordez l'accès à au moins une page ou à l'intégralité de l'espace de travail."
      );
    }

    const page = (await notion.pages.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(pageParams as any),
      parent: { type: "page_id", page_id: parent.id },
    })) as PageObjectResponse;
    return { id: page.id, url: page.url };
  }
}

async function findOrCreateDatabase(
  notion: Client,
  parentPageId: string,
  existingId: string | undefined,
  title: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties: Record<string, any>
): Promise<string> {
  // Try stored ID
  if (existingId) {
    try {
      const db = await notion.databases.retrieve({
        database_id: existingId,
      });
      if (!(db as { archived?: boolean }).archived) {
        // Add any missing properties (schema evolution)
        await addMissingDatabaseProperties(notion, db.id, properties);
        return db.id;
      }
    } catch {
      // Database not found — fall through
    }
  }

  // Search for existing database under this parent
  const search = await notion.search({
    query: title,
    filter: { property: "object", value: "database" },
  });
  for (const result of search.results) {
    if (result.object !== "database") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = result as any;
    if (db.archived) continue;
    if (db.parent?.page_id === parentPageId) {
      const text: string =
        db.title?.map((t: { plain_text: string }) => t.plain_text).join("") ??
        "";
      if (text.includes(title)) {
        await addMissingDatabaseProperties(notion, db.id, properties);
        return db.id;
      }
    }
  }

  // Create the database
  const db = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    properties,
  });
  return db.id;
}

async function findOrCreateProfilePage(
  notion: Client,
  parentPageId: string,
  existingId?: string
): Promise<string> {
  if (existingId) {
    try {
      const page = (await notion.pages.retrieve({
        page_id: existingId,
      })) as PageObjectResponse;
      if (!page.archived) return page.id;
    } catch {
      // fall through
    }
  }

  const page = (await notion.pages.create({
    parent: { type: "page_id", page_id: parentPageId },
    properties: {
      title: {
        title: [{ type: "text", text: { content: "Profil Steam" } }],
      },
    },
  })) as PageObjectResponse;
  return page.id;
}

// ─── Database schemas ─────────────────────────────────────────────────────────

function buildLibraryDbSchema() {
  return {
    Jeu: { title: {} },
    "App ID": { number: { format: "number" } },
    "Temps de jeu (h)": { number: { format: "number" } },
    "Session récente (h)": { number: { format: "number" } },
    "Windows (h)": { number: { format: "number" } },
    "Mac (h)": { number: { format: "number" } },
    "Linux (h)": { number: { format: "number" } },
    "Steam Deck (h)": { number: { format: "number" } },
    "Dernière session": { date: {} },
    "Succès débloqués": { number: { format: "number" } },
    "Total succès": { number: { format: "number" } },
    "% Succès": { number: { format: "number" } },
    "Joueurs actuels": { number: { format: "number" } },
    "Page Steam": { url: {} },
    "Site web": { url: {} },
    Statut: {
      select: {
        options: [
          { name: "Jamais joué", color: "gray" },
          { name: "Lancé", color: "yellow" },
          { name: "En cours", color: "blue" },
          { name: "Joué", color: "green" },
          { name: "Complété à 100%", color: "purple" },
        ],
      },
    },
    "Support manette": {
      select: {
        options: [
          { name: "Complet", color: "green" },
          { name: "Partiel", color: "yellow" },
          { name: "Aucun", color: "gray" },
        ],
      },
    },
    Plateformes: {
      multi_select: {
        options: [
          { name: "Windows", color: "blue" },
          { name: "Mac", color: "gray" },
          { name: "Linux", color: "orange" },
          { name: "Steam Deck", color: "default" },
        ],
      },
    },
    Genres: { multi_select: { options: [] } },
    Catégories: { multi_select: { options: [] } },
    Développeur: { rich_text: {} },
    Éditeur: { rich_text: {} },
    "Date de sortie": { date: {} },
    Metacritic: { number: { format: "number" } },
    Recommandations: { number: { format: "number" } },
    "Âge requis": { number: { format: "number" } },
    Description: { rich_text: {} },
    Gratuit: { checkbox: {} },
    "Prix (€)": { number: { format: "number" } },
    "Nombre de DLC": { number: { format: "number" } },
    "Header (URL)": { url: {} },
    "Capsule (URL)": { url: {} },
    "Portrait (URL)": { url: {} },
    Galerie: { checkbox: {} },
    "Galerie v2": { checkbox: {} },
  };
}

function buildAchievementsDbSchema() {
  return {
    Succès: { title: {} },
    Jeu: { rich_text: {} },
    "App ID": { number: { format: "number" } },
    Description: { rich_text: {} },
    "Image (URL)": { url: {} },
    "Débloqué le": { date: {} },
    "Rareté (%)": { number: { format: "number" } },
    Débloqué: { checkbox: {} },
  };
}

function buildWishlistDbSchema() {
  return {
    Jeu: { title: {} },
    "App ID": { number: { format: "number" } },
    "Page Steam": { url: {} },
    Genres: { multi_select: { options: [] } },
    Développeur: { rich_text: {} },
    Gratuit: { checkbox: {} },
    "Prix (€)": { number: { format: "number" } },
    "Prix initial (€)": { number: { format: "number" } },
    "Remise (%)": { number: { format: "number" } },
    Metacritic: { number: { format: "number" } },
    Priorité: { number: { format: "number" } },
    "Date d'ajout": { date: {} },
  };
}

function buildFriendsDbSchema() {
  return {
    Pseudo: { title: {} },
    "Steam ID": { rich_text: {} },
    Profil: { url: {} },
    Statut: {
      select: {
        options: [
          { name: "En ligne", color: "green" },
          { name: "Hors ligne", color: "gray" },
          { name: "Occupé", color: "red" },
          { name: "Absent", color: "yellow" },
          { name: "Somnolent", color: "yellow" },
          { name: "Cherche à échanger", color: "blue" },
          { name: "Cherche à jouer", color: "blue" },
          { name: "Inconnu", color: "default" },
        ],
      },
    },
    Pays: { rich_text: {} },
    "Nom réel": { rich_text: {} },
    "Dernière connexion": { date: {} },
    "Compte créé le": { date: {} },
    "Ami depuis": { date: {} },
  };
}

function buildBadgesDbSchema() {
  return {
    Badge: { title: {} },
    "Badge ID": { number: { format: "number" } },
    "App ID": { number: { format: "number" } },
    "Page Steam": { url: {} },
    Niveau: { number: { format: "number" } },
    XP: { number: { format: "number" } },
    "Rareté": { number: { format: "number" } },
    "Image (URL)": { url: {} },
    Date: { date: {} },
    "Débloqué": { checkbox: {} },
    Foil: { checkbox: {} },
    "Cartes ajoutées": { checkbox: {} },
    Type: {
      select: {
        options: [
          { name: "Jeu", color: "blue" },
          { name: "Système", color: "gray" },
          { name: "Événement", color: "purple" },
        ],
      },
    },
  };
}

function buildInventoryDbSchema() {
  return {
    Objet: { title: {} },
    Jeu: {
      select: {
        options: [
          { name: "CS2", color: "yellow" },
          { name: "Community", color: "blue" },
          { name: "TF2", color: "red" },
          { name: "Dota 2", color: "purple" },
          { name: "Rust", color: "orange" },
          { name: "Autre", color: "default" },
        ],
      },
    },
    Type: {
      select: {
        options: [
          { name: "Trading Card", color: "blue" },
          { name: "Foil Trading Card", color: "yellow" },
          { name: "Background", color: "purple" },
          { name: "Emoticon", color: "green" },
          { name: "Profile Modifier", color: "pink" },
          { name: "Avatar Frame", color: "orange" },
          { name: "Mini-Profile Background", color: "default" },
          { name: "Weapon Skin", color: "red" },
          { name: "Knife", color: "pink" },
          { name: "Gloves", color: "brown" },
          { name: "Case", color: "gray" },
          { name: "Key", color: "yellow" },
          { name: "Sticker", color: "blue" },
          { name: "Agent", color: "green" },
          { name: "Graffiti", color: "purple" },
          { name: "Music Kit", color: "orange" },
          { name: "Autre", color: "default" },
        ],
      },
    },
    Quantité: { number: { format: "number" } },
    "Class ID": { rich_text: {} },
    "Image (URL)": { url: {} },
    Échangeable: { checkbox: {} },
    Vendable: { checkbox: {} },
  };
}

function buildWorkshopDbSchema() {
  return {
    Titre: { title: {} },
    "File ID": { rich_text: {} },
    "App ID": { number: { format: "number" } },
    "URL Workshop": { url: {} },
    "Preview (URL)": { url: {} },
    Abonnements: { number: { format: "number" } },
    Favoris: { number: { format: "number" } },
    Vues: { number: { format: "number" } },
    Tags: { multi_select: { options: [] } },
    "Créé le": { date: {} },
    "Mis à jour le": { date: {} },
  };
}

function buildGroupsDbSchema() {
  return {
    Groupe: { title: {} },
    "Groupe ID": { rich_text: {} },
    "URL Steam": { url: {} },
  };
}

function buildStatsDbSchema() {
  return {
    Stat: { title: {} },
    Jeu: { rich_text: {} },
    "App ID": { number: { format: "number" } },
    Valeur: { number: { format: "number" } },
    "Mis à jour": { date: {} },
  };
}

// ─── Achievements fetching ────────────────────────────────────────────────────

interface AchievementEntry {
  apiname: string;
  displayName: string;
  description: string;
  icon: string;       // colored (unlocked) icon URL
  icongray: string;  // gray (locked) icon URL
  achieved: boolean;
  unlocktime: number;
  globalPct: number;
  gameName: string;
  appId: number;
}

async function fetchAchievementsForGames(
  steamId: string,
  games: Array<{ appid: number; name: string }>,
  onProgress: (msg: string) => void
): Promise<Map<number, { unlocked: number; total: number; entries: AchievementEntry[] }>> {
  const result = new Map<
    number,
    { unlocked: number; total: number; entries: AchievementEntry[] }
  >();

  for (const game of games) {
    onProgress(`Succès de ${game.name}...`);
    const [achievements, schema, globalPct] = await Promise.all([
      getPlayerAchievements(steamId, game.appid),
      getGameAchievementSchema(game.appid),
      getGlobalAchievementPercentages(game.appid),
    ]);

    if (achievements.length === 0) continue;

    const entries: AchievementEntry[] = achievements.map((a) => ({
      apiname: a.apiname,
      displayName: schema[a.apiname]?.displayName ?? a.apiname,
      description: schema[a.apiname]?.description ?? "",
      icon: schema[a.apiname]?.icon ?? "",
      icongray: schema[a.apiname]?.icongray ?? "",
      achieved: a.achieved === 1,
      unlocktime: a.unlocktime,
      globalPct: Math.round((globalPct[a.apiname] ?? 0) * 10) / 10,
      gameName: game.name,
      appId: game.appid,
    }));

    const unlocked = entries.filter((e) => e.achieved).length;
    result.set(game.appid, { unlocked, total: achievements.length, entries });
  }

  return result;
}

// ─── Games sync ───────────────────────────────────────────────────────────────

async function syncGames(
  notion: Client,
  dbId: string,
  ownedGames: OwnedGame[],
  recentByAppId: Map<number, RecentlyPlayedGame>,
  achievementsMap: Map<
    number,
    { unlocked: number; total: number; entries: AchievementEntry[] }
  >,
  storeDetailsMap: Map<number, AppDetails>,
  playerCountMap: Map<number, number>,
  steamapisDetailsMap: Map<number, SteamapisAppDetails>,
  onProgress: (msg: string) => void
): Promise<number> {
  // Fetch all existing entries to build an appId → { pageId, hasGallery, hasGalleryV2 } map
  onProgress("Lecture des entrées existantes...");
  const existing = await fetchAllDatabasePages(notion, dbId);
  const existingByAppId = new Map<number, { pageId: string; hasGallery: boolean; hasGalleryV2: boolean }>();
  for (const page of existing) {
    const appIdProp = page.properties["App ID"];
    const galerieProp = page.properties["Galerie"];
    const galerieV2Prop = page.properties["Galerie v2"];
    if (appIdProp?.type === "number" && appIdProp.number !== null) {
      existingByAppId.set(appIdProp.number, {
        pageId: page.id,
        hasGallery: galerieProp?.type === "checkbox" ? galerieProp.checkbox : false,
        hasGalleryV2: galerieV2Prop?.type === "checkbox" ? galerieV2Prop.checkbox : false,
      });
    }
  }

  onProgress(
    `${existingByAppId.size} existants · ${ownedGames.length} total — mise à jour...`
  );

  let synced = 0;
  await batchProcess(ownedGames, 5, 1200, async (game) => {
    const existingEntry = existingByAppId.get(game.appid);
    const ach = achievementsMap.get(game.appid);
    const recent = recentByAppId.get(game.appid);
    const storeDetails = storeDetailsMap.get(game.appid);
    const playerCount = playerCountMap.get(game.appid);
    const steamapisDetails = steamapisDetailsMap.get(game.appid);

    const properties = buildGameProperties(game, recent, ach, storeDetails, playerCount, steamapisDetails);
    // Prefer header_image from Store API (new Akamai CDN) over constructed hero URL (old CDN, 404 for newer games)
    const coverUrl = storeDetails?.header_image ?? getGameHeroImageUrl(game.appid);
    const iconUrl = game.img_icon_url
      ? getGameIconUrl(game.appid, game.img_icon_url)
      : null;

    if (existingEntry) {
      await notionRetry(() =>
        notion.pages.update({
          page_id: existingEntry.pageId,
          properties,
          cover: { type: "external", external: { url: coverUrl } },
        })
      );
      if (!existingEntry.hasGallery) {
        // First time: add gallery blocks, mark both Galerie and Galerie v2 as done
        await notionRetry(() =>
          notion.blocks.children.append({
            block_id: existingEntry.pageId,
            children: buildGameImageBlocks(game.appid, storeDetails) as BlockObjectRequest[],
          })
        );
        await notionRetry(() =>
          notion.pages.update({
            page_id: existingEntry.pageId,
            properties: { Galerie: { checkbox: true }, "Galerie v2": { checkbox: true } },
          })
        );
      } else if (!existingEntry.hasGalleryV2 && storeDetails?.header_image) {
        // One-time migration: replace old cdn.cloudflare blocks with new Akamai URLs
        await replaceGalleryBlocks(notion, existingEntry.pageId, game.appid, storeDetails);
        await notionRetry(() =>
          notion.pages.update({
            page_id: existingEntry.pageId,
            properties: { "Galerie v2": { checkbox: true } },
          })
        );
      }
    } else {
      await notionRetry(() =>
        notion.pages.create({
          parent: { database_id: dbId },
          cover: { type: "external", external: { url: coverUrl } },
          ...(iconUrl
            ? { icon: { type: "external", external: { url: iconUrl } } }
            : {}),
          properties: { ...properties, Galerie: { checkbox: true }, "Galerie v2": { checkbox: true } },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          children: buildGameImageBlocks(game.appid, storeDetails) as any,
        })
      );
    }
    synced++;
    if (synced % 25 === 0) {
      onProgress(`${synced}/${ownedGames.length} jeux synchronisés...`);
    }
  });

  return synced;
}

/**
 * Replaces the "Galerie" section in a Notion page (heading_3 + image blocks)
 * with fresh blocks using correct Store API URLs.
 * Used for one-time migration from old cdn.cloudflare URLs to new Akamai URLs.
 */
async function replaceGalleryBlocks(
  notion: Client,
  pageId: string,
  appId: number,
  store: AppDetails
): Promise<void> {
  // 1. List child blocks to find old gallery section
  const { results } = await notionRetry(() =>
    notion.blocks.children.list({ block_id: pageId, page_size: 100 })
  );

  // 2. Identify heading_3 "Galerie" + subsequent image blocks
  let inGallery = false;
  const toDelete: string[] = [];
  for (const block of results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = block as any;
    if (b.type === "heading_3") {
      const text: string = b.heading_3?.rich_text?.[0]?.plain_text ?? "";
      if (text === "Galerie") {
        inGallery = true;
        toDelete.push(b.id);
        continue;
      }
      if (inGallery) break; // Another heading = end of gallery section
    }
    if (inGallery) {
      if (b.type === "image") {
        toDelete.push(b.id);
      } else {
        break; // Stop at first non-image block
      }
    }
  }

  // 3. Delete old gallery blocks one by one
  for (const blockId of toDelete) {
    try {
      await notionRetry(() => notion.blocks.delete({ block_id: blockId }));
    } catch {
      // Non-critical: block may have been deleted already
    }
  }

  // 4. Append fresh gallery blocks with correct Akamai URLs
  await notionRetry(() =>
    notion.blocks.children.append({
      block_id: pageId,
      children: buildGameImageBlocks(appId, store) as BlockObjectRequest[],
    })
  );
}

function buildGameImageBlocks(appId: number, store?: AppDetails): BlockObjectRequest[] {
  // Prefer header_image from Store API (new Akamai CDN) — old cdn.cloudflare header.jpg returns 404 for newer games
  const headerUrl = store?.header_image
    ?? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;

  const blocks: BlockObjectRequest[] = [
    {
      type: "heading_3",
      heading_3: {
        rich_text: [{ type: "text", text: { content: "Galerie" } }],
        color: "default",
        is_toggleable: false,
      },
    },
    {
      type: "image",
      image: {
        type: "external",
        external: { url: headerUrl },
      },
    },
  ];

  // Use screenshots from Store API (guaranteed to exist) — up to 4
  if (store?.screenshots?.length) {
    for (const ss of store.screenshots.slice(0, 4)) {
      blocks.push({
        type: "image",
        image: { type: "external", external: { url: ss.path_full } },
      });
    }
  }

  return blocks;
}

function buildGameProperties(
  game: OwnedGame,
  recent?: RecentlyPlayedGame,
  ach?: { unlocked: number; total: number },
  store?: AppDetails,
  playerCount?: number,
  steamapisDetails?: SteamapisAppDetails
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  const playtimeHours = minutesToHours(game.playtime_forever);
  const playtime2w =
    recent?.playtime_2weeks ?? game.playtime_2weeks
      ? minutesToHours((recent?.playtime_2weeks ?? game.playtime_2weeks)!)
      : null;

  const lastPlayed =
    game.rtime_last_played && game.rtime_last_played > 0
      ? new Date(game.rtime_last_played * 1000).toISOString().split("T")[0]
      : null;

  const platforms: string[] = [];
  if ((game.playtime_windows_forever ?? 0) > 0) platforms.push("Windows");
  if ((game.playtime_mac_forever ?? 0) > 0) platforms.push("Mac");
  if ((game.playtime_linux_forever ?? 0) > 0) platforms.push("Linux");
  if ((game.playtime_deck_forever ?? 0) > 0) platforms.push("Steam Deck");

  const winH = minutesToHours(game.playtime_windows_forever ?? 0);
  const macH = minutesToHours(game.playtime_mac_forever ?? 0);
  const linH = minutesToHours(game.playtime_linux_forever ?? 0);
  const deckH = minutesToHours(game.playtime_deck_forever ?? 0);

  const status = deriveStatus(game, ach);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: Record<string, any> = {
    Jeu: { title: [{ text: { content: game.name } }] },
    "App ID": { number: game.appid },
    "Temps de jeu (h)": { number: playtimeHours },
    "Page Steam": { url: getStorePage(game.appid) },
    Statut: { select: { name: status } },
  };

  if (playtime2w !== null) props["Session récente (h)"] = { number: playtime2w };
  if (lastPlayed) props["Dernière session"] = { date: { start: lastPlayed } };
  if (winH > 0) props["Windows (h)"] = { number: winH };
  if (macH > 0) props["Mac (h)"] = { number: macH };
  if (linH > 0) props["Linux (h)"] = { number: linH };
  if (deckH > 0) props["Steam Deck (h)"] = { number: deckH };
  if (playerCount && playerCount > 0) props["Joueurs actuels"] = { number: playerCount };

  if (ach && ach.total > 0) {
    props["Succès débloqués"] = { number: ach.unlocked };
    props["Total succès"] = { number: ach.total };
    props["% Succès"] = { number: Math.round((ach.unlocked / ach.total) * 100) };
  }
  if (platforms.length > 0) {
    props["Plateformes"] = { multi_select: platforms.map((p) => ({ name: p })) };
  }

  // Store API metadata (only for recently played games)
  if (store) {
    if (store.genres && store.genres.length > 0) {
      props["Genres"] = {
        multi_select: store.genres.map((g) => ({ name: g.description })),
      };
    }
    if (store.developers && store.developers.length > 0) {
      props["Développeur"] = {
        rich_text: [{ text: { content: store.developers.join(", ") } }],
      };
    }
    if (store.publishers && store.publishers.length > 0) {
      props["Éditeur"] = {
        rich_text: [{ text: { content: store.publishers.join(", ") } }],
      };
    }
    if (store.release_date && !store.release_date.coming_soon) {
      // Steam date format varies ("8 mai, 2026" / "May 8, 2026" / "2026")
      // Store as text in rich_text or try to parse to ISO date
      const parsed = parseSteamDate(store.release_date.date);
      if (parsed) props["Date de sortie"] = { date: { start: parsed } };
    }
    if (store.metacritic?.score) {
      props["Metacritic"] = { number: store.metacritic.score };
    }
    if (store.recommendations?.total) {
      props["Recommandations"] = { number: store.recommendations.total };
    }
    if (store.short_description) {
      props["Description"] = {
        rich_text: [
          { text: { content: store.short_description.slice(0, 2000) } },
        ],
      };
    }
    props["Gratuit"] = { checkbox: store.is_free };
    if (!store.is_free && store.price_overview) {
      props["Prix (€)"] = { number: store.price_overview.final / 100 };
    }
    // Fields available in the Store API that were previously steamapis-only
    if (store.categories && store.categories.length > 0) {
      props["Catégories"] = {
        multi_select: store.categories.slice(0, 20).map((c) => ({ name: c.description })),
      };
      // Derive controller support from Steam category IDs (18=partial, 28=full)
      const hasFull = store.categories.some((c) => c.id === 28);
      const hasPartial = store.categories.some((c) => c.id === 18);
      if (hasFull) props["Support manette"] = { select: { name: "Complet" } };
      else if (hasPartial) props["Support manette"] = { select: { name: "Partiel" } };
    }
    if (store.website) {
      props["Site web"] = { url: store.website };
    }
    const requiredAge = Number(store.required_age ?? 0);
    if (requiredAge > 0) {
      props["Âge requis"] = { number: requiredAge };
    }
    if (store.dlc && store.dlc.length > 0) {
      props["Nombre de DLC"] = { number: store.dlc.length };
    }
  }

  // Enriched fields from steamapis.com — overrides Store API only when steamapis has richer data
  if (steamapisDetails) {
    // Only overwrite if the Store API didn't already supply the value
    if (!props["Site web"] && steamapisDetails.website) {
      props["Site web"] = { url: steamapisDetails.website };
    }
    if (!props["Support manette"] && steamapisDetails.controllerSupport) {
      const label =
        steamapisDetails.controllerSupport === "full"
          ? "Complet"
          : steamapisDetails.controllerSupport === "partial"
          ? "Partiel"
          : null;
      if (label) props["Support manette"] = { select: { name: label } };
    }
    // steamapis has more precise recommendation counts — always prefer it
    if (steamapisDetails.recommendations?.total != null) {
      props["Recommandations"] = { number: steamapisDetails.recommendations.total };
    }
    if (!props["Âge requis"] && steamapisDetails.requiredAge > 0) {
      props["Âge requis"] = { number: steamapisDetails.requiredAge };
    }
    if (!props["Catégories"] && steamapisDetails.categories && steamapisDetails.categories.length > 0) {
      props["Catégories"] = {
        multi_select: steamapisDetails.categories
          .slice(0, 20)
          .map((c) => ({ name: c.description })),
      };
    }
    if (!props["Nombre de DLC"] && steamapisDetails.dlc && steamapisDetails.dlc.length > 0) {
      props["Nombre de DLC"] = { number: steamapisDetails.dlc.length };
    }
    // Fill genres/dev/pub/metacritic/price only if Store API didn't provide them
    if (!store && steamapisDetails.genres && steamapisDetails.genres.length > 0) {
      props["Genres"] = {
        multi_select: steamapisDetails.genres.map((g) => ({ name: g.description })),
      };
    }
    if (!store && steamapisDetails.developers && steamapisDetails.developers.length > 0) {
      props["Développeur"] = {
        rich_text: [{ text: { content: steamapisDetails.developers.join(", ") } }],
      };
    }
    if (!store && steamapisDetails.publishers && steamapisDetails.publishers.length > 0) {
      props["Éditeur"] = {
        rich_text: [{ text: { content: steamapisDetails.publishers.join(", ") } }],
      };
    }
    if (!store && steamapisDetails.metacritic?.score != null) {
      props["Metacritic"] = { number: steamapisDetails.metacritic.score };
    }
    if (!store) {
      props["Gratuit"] = { checkbox: steamapisDetails.isFree };
      if (!steamapisDetails.isFree && steamapisDetails.priceOverview?.final != null) {
        props["Prix (€)"] = { number: steamapisDetails.priceOverview.final / 100 };
      }
    }
  }

  // Image URLs: prefer Store API values (new Akamai CDN) over constructed ones (old CDN, 404 for newer games)
  props["Header (URL)"] = { url: store?.header_image ?? getGameHeaderImageUrl(game.appid) };
  props["Capsule (URL)"] = { url: store?.capsule_image ?? getGameCapsuleImageUrl(game.appid) };
  props["Portrait (URL)"] = {
    url: store?.header_image ?? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_600x900_2x.jpg`,
  };

  return props;
}

/** Parse Steam's localized date string to ISO YYYY-MM-DD. Returns null if unparseable. */
/** Parse Steam date string to ISO YYYY-MM-DD. Handles English and French locales. */
const FRENCH_MONTHS: Record<string, number> = {
  janvier: 0, février: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, août: 7, septembre: 8, octobre: 9, novembre: 10, décembre: 11,
};

function parseSteamDate(dateStr: string): string | null {
  if (!dateStr) return null;
  // Standard JS parsing (works for English: "May 8, 2026", ISO dates, year-only)
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  } catch { /* ignore */ }
  // French format: "8 mai 2026", "8 mai, 2026", "mai 2026"
  const normalized = dateStr.toLowerCase().replace(/,/g, "").trim();
  const parts = normalized.split(/\s+/);
  for (const [name, idx] of Object.entries(FRENCH_MONTHS)) {
    const mIdx = parts.indexOf(name);
    if (mIdx === -1) continue;
    const yearPart = parts.find((p) => /^\d{4}$/.test(p));
    if (!yearPart) continue;
    const dayPart = parts.find((p) => /^\d{1,2}$/.test(p) && parseInt(p) <= 31);
    const d = new Date(parseInt(yearPart), idx, dayPart ? parseInt(dayPart) : 1);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return null;
}

function deriveStatus(
  game: OwnedGame,
  ach?: { unlocked: number; total: number }
): string {
  if (game.playtime_forever === 0) return "Jamais joué";
  if (ach && ach.total > 0 && ach.unlocked === ach.total)
    return "Complété à 100%";
  if (game.playtime_2weeks && game.playtime_2weeks > 0) return "En cours";
  if (game.rtime_last_played) {
    const sixMonthsAgo = Date.now() / 1000 - 60 * 60 * 24 * 180;
    if (game.rtime_last_played > sixMonthsAgo) return "En cours";
  }
  if (game.playtime_forever < 60) return "Lancé"; // < 1 hour
  return "Joué";
}

// ─── Achievements sync ────────────────────────────────────────────────────────

async function syncAchievements(
  notion: Client,
  dbId: string,
  achievementsMap: Map<
    number,
    { unlocked: number; total: number; entries: AchievementEntry[] }
  >,
  onProgress: (msg: string) => void
): Promise<number> {
  // Collect ALL entries (locked + unlocked)
  const allEntries: AchievementEntry[] = [];
  for (const { entries } of achievementsMap.values()) {
    allEntries.push(...entries);
  }

  if (allEntries.length === 0) return 0;

  // Fetch existing entries to detect new ones and status changes
  const existing = await fetchAllDatabasePages(notion, dbId);
  const existingMap = new Map<string, { pageId: string; isUnlocked: boolean }>();
  for (const page of existing) {
    const appIdProp = page.properties["App ID"];
    const nameProp = page.properties["Succès"];
    const unlockedProp = page.properties["Débloqué"];
    const appId =
      appIdProp?.type === "number" ? (appIdProp.number ?? 0) : 0;
    const name =
      nameProp?.type === "title"
        ? nameProp.title.map((t) => t.plain_text).join("")
        : "";
    const isUnlocked =
      unlockedProp?.type === "checkbox" ? unlockedProp.checkbox : false;
    existingMap.set(`${appId}::${name}`, { pageId: page.id, isUnlocked });
  }

  const toCreate: AchievementEntry[] = [];
  const toUpdate: Array<{ pageId: string; entry: AchievementEntry }> = [];

  for (const entry of allEntries) {
    const key = `${entry.appId}::${entry.displayName}`;
    const existingEntry = existingMap.get(key);
    if (!existingEntry) {
      toCreate.push(entry);
    } else if (entry.achieved && !existingEntry.isUnlocked) {
      toUpdate.push({ pageId: existingEntry.pageId, entry });
    }
  }

  onProgress(
    `${toCreate.length} nouveaux succès · ${toUpdate.length} déblocages...`
  );

  // Create new entries
  await batchProcess(toCreate, 5, 1000, async (entry) => {
    const unlockDate =
      entry.achieved && entry.unlocktime > 0
        ? new Date(entry.unlocktime * 1000).toISOString().split("T")[0]
        : null;

    // Use colored icon for unlocked achievements, gray icon for locked ones
    const pageIconUrl = entry.achieved
      ? (entry.icon || entry.icongray || null)
      : (entry.icongray || entry.icon || null);

    await notionRetry(() =>
      notion.pages.create({
        parent: { database_id: dbId },
        ...(pageIconUrl
          ? { icon: { type: "external", external: { url: pageIconUrl } } }
          : {}),
        properties: {
          Succès: { title: [{ text: { content: entry.displayName } }] },
          Jeu: { rich_text: [{ text: { content: entry.gameName } }] },
          "App ID": { number: entry.appId },
          Description: {
            rich_text: [{ text: { content: entry.description ?? "" } }],
          },
          "Rareté (%)": { number: entry.globalPct },
          Débloqué: { checkbox: entry.achieved },
          ...(entry.icon ? { "Image (URL)": { url: entry.icon } } : {}),
          ...(unlockDate
            ? { "Débloqué le": { date: { start: unlockDate } } }
            : {}),
        },
      })
    );
  });

  // Update entries that were just unlocked
  await batchProcess(toUpdate, 5, 1000, async ({ pageId, entry }) => {
    const unlockDate =
      entry.unlocktime > 0
        ? new Date(entry.unlocktime * 1000).toISOString().split("T")[0]
        : null;
    await notionRetry(() =>
      notion.pages.update({
        page_id: pageId,
        properties: {
          Débloqué: { checkbox: true },
          ...(unlockDate
            ? { "Débloqué le": { date: { start: unlockDate } } }
            : {}),
        },
      })
    );
  });

  return allEntries.filter((e) => e.achieved).length;
}

// ─── Profile page ─────────────────────────────────────────────────────────────

interface ProfileData {
  profile: SteamProfile;
  steamLevel: number;
  friendCount: number;
  bans: Awaited<ReturnType<typeof getPlayerBans>>;
  ownedGames: OwnedGame[];
  recentGames: RecentlyPlayedGame[];
  playerBadges: PlayerBadgesData | null;
  wishlistCount?: number;
  workshopCount?: number;
  groupsCount?: number;
}

async function updateProfilePage(
  notion: Client,
  pageId: string,
  data: ProfileData
): Promise<void> {
  // Clear existing non-database blocks
  const childrenResp = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });
  const toDelete = childrenResp.results.filter(
    (b) =>
      (b as { type?: string }).type !== "child_database" &&
      (b as { type?: string }).type !== "child_page"
  );
  await batchProcess(toDelete, 5, 1200, async (block) => {
    await notionRetry(() =>
      notion.blocks.delete({ block_id: block.id })
    );
  });

  const blocks = buildProfileBlocks(data);
  // Notion limits to 100 blocks per append — split if needed
  for (let i = 0; i < blocks.length; i += 100) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(i, i + 100) as BlockObjectRequest[],
    });
  }
}

function buildProfileBlocks(data: ProfileData): BlockObjectRequest[] {
  const { profile, steamLevel, friendCount, bans, ownedGames, recentGames, playerBadges, wishlistCount, workshopCount, groupsCount } =
    data;

  const totalPlaytime = Math.round(
    ownedGames.reduce((acc, g) => acc + g.playtime_forever, 0) / 60
  );
  const neverPlayed = ownedGames.filter(
    (g) => g.playtime_forever === 0
  ).length;
  const syncDate = new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const blocks: BlockObjectRequest[] = [
    // Last sync callout
    {
      type: "callout",
      callout: {
        rich_text: [
          {
            type: "text",
            text: { content: `Dernière synchronisation : ${syncDate}` },
          },
        ],
        color: "blue_background",
      },
    },
    { type: "divider", divider: {} },
    // Profile heading
    {
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "Profil" } }],
        color: "default",
        is_toggleable: false,
      },
    },
    {
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content: `${profile.personaname}`,
            },
            annotations: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
          },
          {
            type: "text",
            text: {
              content: ` · Niveau ${steamLevel}`,
            },
          },
          ...(friendCount >= 0
            ? [
                {
                  type: "text" as const,
                  text: { content: ` · ${friendCount} amis` },
                },
              ]
            : []),
        ],
      },
    },
    {
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content: "Voir le profil Steam",
              link: { url: profile.profileurl },
            },
            annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
          },
        ],
      },
    },
    ...(playerBadges
      ? [
          {
            type: "bulleted_list_item" as const,
            bulleted_list_item: {
              rich_text: [
                {
                  type: "text" as const,
                  text: {
                    content: `${playerBadges.player_xp.toLocaleString("fr-FR")} XP · ${playerBadges.badges.length} badges`,
                  },
                },
              ],
              color: "default" as const,
            },
          },
          {
            type: "bulleted_list_item" as const,
            bulleted_list_item: {
              rich_text: [
                {
                  type: "text" as const,
                  text: {
                    content: `${playerBadges.player_xp_needed_to_level_up.toLocaleString("fr-FR")} XP pour le niveau ${playerBadges.player_level + 1}`,
                  },
                },
              ],
              color: "default" as const,
            },
          },
        ]
      : []),
    { type: "divider" as const, divider: {} },
    // Stats heading
    {
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "Bibliothèque" } }],
        color: "default",
        is_toggleable: false,
      },
    },
    {
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: { content: `${ownedGames.length} jeux possédés` },
          },
        ],
        color: "default",
      },
    },
    {
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: { content: `${totalPlaytime}h de jeu total` },
          },
        ],
        color: "default",
      },
    },
    {
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [
          {
            type: "text",
            text: {
              content: `${neverPlayed} jeux jamais lancés (${Math.round((neverPlayed / ownedGames.length) * 100)}%)`,
            },
          },
        ],
        color: "default",
      },
    },
    ...(wishlistCount != null && wishlistCount > 0
      ? [
          {
            type: "bulleted_list_item" as const,
            bulleted_list_item: {
              rich_text: [
                {
                  type: "text" as const,
                  text: { content: `${wishlistCount} jeux dans la liste de souhaits` },
                },
              ],
              color: "default" as const,
            },
          },
        ]
      : []),
    ...(workshopCount != null && workshopCount > 0
      ? [
          {
            type: "bulleted_list_item" as const,
            bulleted_list_item: {
              rich_text: [
                {
                  type: "text" as const,
                  text: { content: `${workshopCount} élément(s) publiés sur le Workshop` },
                },
              ],
              color: "default" as const,
            },
          },
        ]
      : []),
    ...(groupsCount != null && groupsCount > 0
      ? [
          {
            type: "bulleted_list_item" as const,
            bulleted_list_item: {
              rich_text: [
                {
                  type: "text" as const,
                  text: { content: `Membre de ${groupsCount} groupe(s) Steam` },
                },
              ],
              color: "default" as const,
            },
          },
        ]
      : []),
  ];

  // Bans section (only if any ban exists)
  if (bans && (bans.VACBanned || bans.NumberOfGameBans > 0)) {
    blocks.push({ type: "divider", divider: {} });
    blocks.push({
      type: "callout",
      callout: {
        rich_text: [
          {
            type: "text",
            text: {
              content: [
                bans.VACBanned ? `VAC Ban (${bans.NumberOfVACBans} ban(s), il y a ${bans.DaysSinceLastBan} jours)` : null,
                bans.NumberOfGameBans > 0 ? `${bans.NumberOfGameBans} Game Ban(s)` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            },
          },
        ],
        color: "red_background",
      },
    });
  }

  // Recent activity
  if (recentGames.length > 0) {
    blocks.push({ type: "divider", divider: {} });
    blocks.push({
      type: "heading_2",
      heading_2: {
        rich_text: [
          {
            type: "text",
            text: { content: "Activité récente (14 derniers jours)" },
          },
        ],
        color: "default",
        is_toggleable: false,
      },
    });
    for (const game of recentGames) {
      const hours = minutesToHours(game.playtime_2weeks);
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [
            {
              type: "text",
              text: {
                content: `${game.name}`,
                link: { url: `https://store.steampowered.com/app/${game.appid}` },
              },
              annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
            },
            {
              type: "text",
              text: { content: ` — ${hours}h` },
            },
          ],
          color: "default",
        },
      });
    }
  }

  return blocks;
}

// ─── Friends enrichment ───────────────────────────────────────────────────────

async function enrichFriends(
  friends: SteamFriend[]
): Promise<Array<SteamFriend & SteamPlayerSummary>> {
  const result: Array<SteamFriend & SteamPlayerSummary> = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < friends.length; i += BATCH_SIZE) {
    const batch = friends.slice(i, i + BATCH_SIZE);
    const summaries = await getPlayerSummaries(batch.map((f) => f.steamid));
    const summaryMap = new Map(summaries.map((s) => [s.steamid, s]));
    for (const friend of batch) {
      const summary = summaryMap.get(friend.steamid);
      if (summary) result.push({ ...friend, ...summary });
    }
    if (i + BATCH_SIZE < friends.length) await sleep(500);
  }
  return result;
}

// ─── Wishlist sync ────────────────────────────────────────────────────────────

async function syncWishlist(
  notion: Client,
  dbId: string,
  wishlist: WishlistItem[],
  storeDetailsMap: Map<number, AppDetails>,
  onProgress: (msg: string) => void
): Promise<number> {
  if (wishlist.length === 0) return 0;

  const existing = await fetchAllDatabasePages(notion, dbId);
  const existingByAppId = new Map<number, string>();
  for (const page of existing) {
    const appIdProp = page.properties["App ID"];
    if (appIdProp?.type === "number" && appIdProp.number !== null) {
      existingByAppId.set(appIdProp.number, page.id);
    }
  }

  let synced = 0;
  await batchProcess(wishlist, 5, 1200, async (item) => {
    const store = storeDetailsMap.get(item.appid);
    const addedDate =
      item.added > 0
        ? new Date(item.added * 1000).toISOString().split("T")[0]
        : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = {
      Jeu: {
        title: [{ text: { content: store?.name ?? `App ${item.appid}` } }],
      },
      "App ID": { number: item.appid },
      "Page Steam": { url: getStorePage(item.appid) },
      Priorité: { number: item.priority },
      ...(addedDate ? { "Date d'ajout": { date: { start: addedDate } } } : {}),
    };

    if (store) {
      if (store.genres?.length) {
        properties["Genres"] = {
          multi_select: store.genres.map((g) => ({ name: g.description })),
        };
      }
      if (store.developers?.length) {
        properties["Développeur"] = {
          rich_text: [{ text: { content: store.developers.join(", ") } }],
        };
      }
      properties["Gratuit"] = { checkbox: store.is_free };
      if (!store.is_free && store.price_overview) {
        const po = store.price_overview;
        // Current (discounted) price
        properties["Prix (€)"] = { number: po.final / 100 };
        // Original price (only differs when there's a discount)
        if (po.discount_percent > 0) {
          properties["Prix initial (€)"] = { number: po.initial / 100 };
          properties["Remise (%)"] = { number: po.discount_percent };
        }
      }
      if (store.metacritic?.score) {
        properties["Metacritic"] = { number: store.metacritic.score };
      }
    }

    const coverUrl = getGameHeroImageUrl(item.appid);
    const iconUrl = getGameHeaderImageUrl(item.appid);
    const existingPageId = existingByAppId.get(item.appid);
    if (existingPageId) {
      await notionRetry(() =>
        notion.pages.update({
          page_id: existingPageId,
          properties,
          cover: { type: "external", external: { url: coverUrl } },
          icon: { type: "external", external: { url: iconUrl } },
        })
      );
    } else {
      await notionRetry(() =>
        notion.pages.create({
          parent: { database_id: dbId },
          cover: { type: "external", external: { url: coverUrl } },
          icon: { type: "external", external: { url: iconUrl } },
          properties,
        })
      );
    }
    synced++;
  });

  onProgress(`${synced} jeux dans la liste de souhaits synchronisés.`);
  return synced;
}

// ─── Friends sync ─────────────────────────────────────────────────────────────

async function syncFriends(
  notion: Client,
  dbId: string,
  friends: Array<SteamFriend & SteamPlayerSummary>,
  onProgress: (msg: string) => void
): Promise<number> {
  if (friends.length === 0) return 0;

  const existing = await fetchAllDatabasePages(notion, dbId);
  const existingBySteamId = new Map<string, string>();
  for (const page of existing) {
    const idProp = page.properties["Steam ID"];
    if (idProp?.type === "rich_text") {
      const steamId = idProp.rich_text.map((t) => t.plain_text).join("");
      if (steamId) existingBySteamId.set(steamId, page.id);
    }
  }

  let synced = 0;
  await batchProcess(friends, 5, 1200, async (friend) => {
    const statLabel = getPersonaStateLabel(friend.personastate ?? 0);
    const friendSince =
      friend.friend_since > 0
        ? new Date(friend.friend_since * 1000).toISOString().split("T")[0]
        : null;
    const lastLogoff =
      friend.lastlogoff && friend.lastlogoff > 0
        ? new Date(friend.lastlogoff * 1000).toISOString().split("T")[0]
        : null;
    const accountCreated =
      friend.timecreated && friend.timecreated > 0
        ? new Date(friend.timecreated * 1000).toISOString().split("T")[0]
        : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = {
      Pseudo: {
        title: [
          { text: { content: friend.personaname ?? `Steam ${friend.steamid}` } },
        ],
      },
      "Steam ID": { rich_text: [{ text: { content: friend.steamid } }] },
      Profil: { url: friend.profileurl },
      Statut: { select: { name: statLabel } },
      ...(friend.loccountrycode
        ? { Pays: { rich_text: [{ text: { content: friend.loccountrycode } }] } }
        : {}),
      ...(friend.realname
        ? { "Nom réel": { rich_text: [{ text: { content: friend.realname } }] } }
        : {}),
      ...(friendSince ? { "Ami depuis": { date: { start: friendSince } } } : {}),
      ...(lastLogoff ? { "Dernière connexion": { date: { start: lastLogoff } } } : {}),
      ...(accountCreated ? { "Compte créé le": { date: { start: accountCreated } } } : {}),
    };

    const avatarUrl = friend.avatarfull ?? "";
    const existingPageId = existingBySteamId.get(friend.steamid);
    if (existingPageId) {
      await notionRetry(() =>
        notion.pages.update({
          page_id: existingPageId,
          properties,
          ...(avatarUrl
            ? {
                cover: { type: "external", external: { url: avatarUrl } },
                icon: { type: "external", external: { url: avatarUrl } },
              }
            : {}),
        })
      );
    } else {
      await notionRetry(() =>
        notion.pages.create({
          parent: { database_id: dbId },
          ...(avatarUrl
            ? {
                cover: { type: "external", external: { url: avatarUrl } },
                icon: { type: "external", external: { url: avatarUrl } },
              }
            : {}),
          properties,
        })
      );
    }
    synced++;
  });

  onProgress(`${synced} amis synchronisés.`);
  return synced;
}

// ─── Badges sync ─────────────────────────────────────────────────────────────

async function syncBadges(
  notion: Client,
  dbId: string,
  badges: PlayerBadge[],
  gameNameMap: Map<number, string>,
  gameIconMap: Map<number, string>,
  inventoryItems: InventoryItem[],
  onProgress: (msg: string) => void
): Promise<number> {
  // ── 1. Badge asset info (real names + icons) from Steam Economy API ─────
  const idsWithItems = badges
    .map((b) => b.communityitemid)
    .filter((id): id is string => !!id);

  onProgress(`Récupération des icônes Steam pour ${idsWithItems.length} badges...`);
  const assetInfoMap: Map<string, BadgeAssetInfo> =
    idsWithItems.length > 0
      ? await getBadgeAssetInfoBatch(idsWithItems)
      : new Map();

  // ── 2. Trading cards for all game badges (parallel batches) ────────────
  const gameAppIds = [
    ...new Set(badges.filter((b) => (b.appid ?? 0) > 0).map((b) => b.appid!)),
  ];
  const cardsByAppId = new Map<number, TradingCard[]>();
  if (gameAppIds.length > 0) {
    onProgress(`Récupération des cartes pour ${gameAppIds.length} jeux...`);
    const CARD_BATCH = 5;
    for (let i = 0; i < gameAppIds.length; i += CARD_BATCH) {
      const batch = gameAppIds.slice(i, i + CARD_BATCH);
      const results = await Promise.all(
        batch.map((appId) => getTradingCardsForApp(appId))
      );
      batch.forEach((appId, idx) => {
        if (results[idx].length > 0) cardsByAppId.set(appId, results[idx]);
      });
      if (i + CARD_BATCH < gameAppIds.length) await sleep(1200);
    }
    onProgress(`Cartes récupérées pour ${cardsByAppId.size} jeux.`);
  }

  // ── 3. Owned cards from user's inventory, keyed by appId ───────────────
  // Trading cards have item_class_2 tag and a Game_{appid} tag.
  const ownedCardsByAppId = new Map<number, Set<string>>();
  for (const item of inventoryItems) {
    const gameTag = item.tags?.find((t) => t.category === "Game");
    const classTag = item.tags?.find(
      (t) => t.category === "item_class" && t.internal_name === "item_class_2"
    );
    if (!gameTag || !classTag) continue;
    const match = gameTag.internal_name.match(/^Game_(\d+)$/);
    if (!match) continue;
    const appId = parseInt(match[1], 10);
    if (!ownedCardsByAppId.has(appId)) ownedCardsByAppId.set(appId, new Set());
    ownedCardsByAppId.get(appId)!.add(item.market_name);
  }

  // ── 4. Fetch existing badge pages ─────────────────────────────────────
  const existing = await fetchAllDatabasePages(notion, dbId);
  // Key: "badgeid:level" → { pageId, hasCards }
  const existingByKey = new Map<string, { pageId: string; hasCards: boolean }>();
  for (const page of existing) {
    const idProp = page.properties["Badge ID"];
    const lvlProp = page.properties["Niveau"];
    const hasCardsProp = page.properties["Cartes ajoutées"];
    const id = idProp?.type === "number" ? (idProp.number ?? 0) : 0;
    const lvl = lvlProp?.type === "number" ? (lvlProp.number ?? 0) : 0;
    const hasCards =
      hasCardsProp?.type === "checkbox" ? hasCardsProp.checkbox : false;
    existingByKey.set(`${id}:${lvl}`, { pageId: page.id, hasCards });
  }

  // ── 5. Sync each badge ───────────────────────────────────────────────
  let synced = 0;
  await batchProcess(badges, 5, 1000, async (badge) => {
    const isGameBadge = (badge.appid ?? 0) > 0;
    const assetInfo = badge.communityitemid
      ? assetInfoMap.get(badge.communityitemid)
      : undefined;

    // Badge name: prefer real name from Steam Economy API
    let badgeName: string;
    if (assetInfo?.name) {
      badgeName = assetInfo.name;
    } else if (isGameBadge && badge.appid) {
      const gameName = gameNameMap.get(badge.appid) ?? `App ${badge.appid}`;
      badgeName = `${gameName} — Badge niveau ${badge.level}`;
    } else {
      badgeName = `Badge #${badge.badgeid} (Niveau ${badge.level})`;
    }

    const badgeType = isGameBadge ? "Jeu" : "Système";
    const isFoil = (badge.border_color ?? 0) > 0;

    // Badge icon: Economy CDN URL from asset info, fallback to game icon or system badge CDN
    let imageUrl: string | null = null;
    const iconHash = assetInfo?.icon_url || assetInfo?.icon_url_large;
    if (iconHash) {
      imageUrl = getBadgeIconCdnUrl(iconHash);
    } else if (isGameBadge && badge.appid) {
      // Fallback: use the game's small icon as the badge page icon
      const gameImgHash = gameIconMap.get(badge.appid);
      if (gameImgHash) {
        imageUrl = getGameIconUrl(badge.appid, gameImgHash);
      }
    } else if (!isGameBadge) {
      imageUrl = `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/badges/${badge.badgeid}/${badge.level}.png`;
    }

    // Cover: game banner for game badges, badge icon for system badges
    const coverUrl =
      isGameBadge && badge.appid
        ? getGameHeaderImageUrl(badge.appid)
        : (imageUrl ?? null);

    const completionDate =
      badge.completion_time > 0
        ? new Date(badge.completion_time * 1000).toISOString().split("T")[0]
        : null;

    // Trading cards for this badge
    const allCards =
      isGameBadge && badge.appid
        ? (cardsByAppId.get(badge.appid) ?? [])
        : [];
    const ownedCardNames =
      isGameBadge && badge.appid
        ? (ownedCardsByAppId.get(badge.appid) ?? new Set<string>())
        : new Set<string>();
    const hasCardsData = allCards.length > 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = {
      Badge: { title: [{ text: { content: badgeName } }] },
      "Badge ID": { number: badge.badgeid },
      Niveau: { number: badge.level },
      XP: { number: badge.xp },
      "Rareté": { number: badge.scarcity },
      "Débloqué": { checkbox: true }, // GetBadges only returns earned badges
      Foil: { checkbox: isFoil },
      Type: { select: { name: badgeType } },
      ...(isGameBadge && badge.appid
        ? {
            "App ID": { number: badge.appid },
            "Page Steam": { url: getStorePage(badge.appid) },
          }
        : {}),
      ...(completionDate ? { Date: { date: { start: completionDate } } } : {}),
      ...(imageUrl ? { "Image (URL)": { url: imageUrl } } : {}),
    };

    const key = `${badge.badgeid}:${badge.level}`;
    const existingEntry = existingByKey.get(key);
    const needsCards = hasCardsData && !(existingEntry?.hasCards ?? false);

    if (existingEntry) {
      // Update properties + cover + icon
      await notionRetry(() =>
        notion.pages.update({
          page_id: existingEntry.pageId,
          properties: {
            ...properties,
            ...(needsCards ? { "Cartes ajoutées": { checkbox: true } } : {}),
          },
          ...(coverUrl
            ? { cover: { type: "external", external: { url: coverUrl } } }
            : {}),
          ...(imageUrl
            ? { icon: { type: "external", external: { url: imageUrl } } }
            : {}),
        })
      );
      // Append card blocks if not already there
      if (needsCards) {
        const cardBlocks = buildBadgeCardBlocks(
          allCards,
          ownedCardNames
        ) as BlockObjectRequest[];
        for (let i = 0; i < cardBlocks.length; i += 100) {
          await notionRetry(() =>
            notion.blocks.children.append({
              block_id: existingEntry.pageId,
              children: cardBlocks.slice(i, i + 100),
            })
          );
        }
      }
    } else {
      // Create new badge page, embed card blocks directly
      const cardBlocks = hasCardsData
        ? (buildBadgeCardBlocks(allCards, ownedCardNames) as BlockObjectRequest[])
        : [];
      await notionRetry(() =>
        notion.pages.create({
          parent: { database_id: dbId },
          ...(coverUrl
            ? { cover: { type: "external", external: { url: coverUrl } } }
            : {}),
          ...(imageUrl
            ? { icon: { type: "external", external: { url: imageUrl } } }
            : {}),
          properties: {
            ...properties,
            "Cartes ajoutées": { checkbox: hasCardsData },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          children: cardBlocks as any,
        })
      );
    }
    synced++;
  });

  onProgress(`${synced} badges synchronisés.`);
  return synced;
}

/**
 * Build Notion blocks for the trading cards section inside a badge page.
 * Shows each card's image with a caption indicating owned (✅) or missing (❌).
 */
function buildBadgeCardBlocks(
  cards: TradingCard[],
  ownedNames: Set<string>
): BlockObjectRequest[] {
  const ownedCount = cards.filter((c) => ownedNames.has(c.name)).length;

  const blocks: BlockObjectRequest[] = [
    {
      type: "heading_3",
      heading_3: {
        rich_text: [
          {
            type: "text",
            text: {
              content: `Cartes — ${ownedCount}/${cards.length} possédées`,
            },
          },
        ],
        color: "default",
        is_toggleable: false,
      },
    },
  ];

  for (const card of cards) {
    const isOwned = ownedNames.has(card.name);
    const cardImageUrl = `https://cdn.cloudflare.steamstatic.com/economy/image/${card.icon_url}`;
    blocks.push({
      type: "image",
      image: {
        type: "external",
        external: { url: cardImageUrl },
        caption: [
          {
            type: "text",
            text: { content: `${isOwned ? "✅" : "❌"} ${card.name}` },
            annotations: {
              bold: isOwned,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: isOwned ? "green" : "red",
            },
          },
        ],
      },
    });
  }

  return blocks;
}

// ─── Inventory sync ───────────────────────────────────────────────────────────

async function syncInventory(
  notion: Client,
  dbId: string,
  items: InventoryItem[],
  onProgress: (msg: string) => void
): Promise<number> {
  if (items.length === 0) return 0;

  // Aggregate by classid: keep first occurrence of the item metadata, count quantity
  const byClassId = new Map<
    string,
    { item: InventoryItem; quantity: number }
  >();
  for (const item of items) {
    const entry = byClassId.get(item.classid);
    if (entry) {
      entry.quantity++;
    } else {
      byClassId.set(item.classid, { item, quantity: 1 });
    }
  }
  const aggregated = Array.from(byClassId.values());

  const existing = await fetchAllDatabasePages(notion, dbId);
  const existingByClassId = new Map<string, string>();
  for (const page of existing) {
    const cidProp = page.properties["Class ID"];
    if (cidProp?.type === "rich_text") {
      const cid = cidProp.rich_text.map((t) => t.plain_text).join("");
      if (cid) existingByClassId.set(cid, page.id);
    }
  }

  // Normalise item type string to select option name
  function normaliseType(raw: string, source?: string): string {
    const r = raw.toLowerCase();
    if (/foil/i.test(r) && /trading card/i.test(r)) return "Foil Trading Card";
    if (/trading card/i.test(r)) return "Trading Card";
    if (/background/i.test(r)) return "Background";
    if (/emoticon/i.test(r)) return "Emoticon";
    if (/profile modifier/i.test(r)) return "Profile Modifier";
    if (/avatar frame/i.test(r)) return "Avatar Frame";
    if (/mini.profile/i.test(r)) return "Mini-Profile Background";
    if (/music kit/i.test(r)) return "Music Kit";
    if (/graffiti/i.test(r) || /spray/i.test(r)) return "Graffiti";
    if (/sticker/i.test(r)) return "Sticker";
    if (/agent/i.test(r)) return "Agent";
    if (/gloves|hand wraps/i.test(r)) return "Gloves";
    if (/★/.test(raw) || /knife|karambit|butterfly|bayonet|falchion|flip|gut|huntsman|navaja|paracord|shadow|skeleton|stiletto|talon|ursus/i.test(r)) return "Knife";
    if (/case/i.test(r) && !/key/i.test(r)) return "Case";
    if (/key/i.test(r)) return "Key";
    if (source === "CS2") return "Weapon Skin";
    return "Autre";
  }

  let synced = 0;
  await batchProcess(aggregated, 5, 1000, async ({ item, quantity }) => {
    const typeName = normaliseType(item.type, item.source);
    const gameLabel = item.source ?? "Autre";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = {
      Objet: { title: [{ text: { content: item.name } }] },
      Jeu: { select: { name: gameLabel } },
      "Class ID": { rich_text: [{ text: { content: item.classid } }] },
      Type: { select: { name: typeName } },
      Quantité: { number: quantity },
      "Image (URL)": { url: item.icon_url },
      Échangeable: { checkbox: item.tradable },
      Vendable: { checkbox: item.marketable },
    };

    const existingPageId = existingByClassId.get(item.classid);
    if (existingPageId) {
      await notionRetry(() =>
        notion.pages.update({
          page_id: existingPageId,
          properties,
          cover: { type: "external", external: { url: item.icon_url } },
        })
      );
    } else {
      await notionRetry(() =>
        notion.pages.create({
          parent: { database_id: dbId },
          cover: { type: "external", external: { url: item.icon_url } },
          icon: { type: "external", external: { url: item.icon_url } },
          properties,
        })
      );
    }
    synced++;
  });

  onProgress(`${synced} types d'objets synchronisés (${items.length} total).`);
  return items.length;
}

async function syncWorkshop(
  notion: Client,
  dbId: string,
  items: WorkshopItem[],
  onProgress: (msg: string) => void
): Promise<number> {
  if (items.length === 0) return 0;

  const existing = await fetchAllDatabasePages(notion, dbId);
  const existingByFileId = new Map<string, string>();
  for (const page of existing) {
    const fidProp = page.properties["File ID"];
    if (fidProp?.type === "rich_text") {
      const fid = fidProp.rich_text.map((t: { plain_text: string }) => t.plain_text).join("");
      if (fid) existingByFileId.set(fid, page.id);
    }
  }

  let synced = 0;
  await batchProcess(items, 5, 1000, async (item) => {
    const workshopUrl = getWorkshopItemUrl(item.publishedfileid);
    const appId = item.consumer_appid || item.creator_appid;
    const createdDate = item.time_created
      ? new Date(item.time_created * 1000).toISOString().split("T")[0]
      : null;
    const updatedDate = item.time_updated
      ? new Date(item.time_updated * 1000).toISOString().split("T")[0]
      : null;
    const coverUrl = item.preview_url ?? getGameHeaderImageUrl(appId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = {
      Titre: { title: [{ text: { content: item.title.slice(0, 2000) } }] },
      "File ID": { rich_text: [{ text: { content: item.publishedfileid } }] },
      "App ID": { number: appId },
      "URL Workshop": { url: workshopUrl },
      ...(item.preview_url ? { "Preview (URL)": { url: item.preview_url } } : {}),
      ...(item.subscriptions != null ? { Abonnements: { number: item.subscriptions } } : {}),
      ...(item.favorited != null ? { Favoris: { number: item.favorited } } : {}),
      ...(item.views != null ? { Vues: { number: item.views } } : {}),
      ...(item.tags?.length
        ? {
            Tags: {
              multi_select: item.tags.map((t) => ({
                name: (t.display_name ?? t.tag).slice(0, 100),
              })),
            },
          }
        : {}),
      ...(createdDate ? { "Créé le": { date: { start: createdDate } } } : {}),
      ...(updatedDate ? { "Mis à jour le": { date: { start: updatedDate } } } : {}),
    };

    const existingPageId = existingByFileId.get(item.publishedfileid);
    if (existingPageId) {
      await notionRetry(() =>
        notion.pages.update({
          page_id: existingPageId,
          properties,
          cover: { type: "external", external: { url: coverUrl } },
        })
      );
    } else {
      await notionRetry(() =>
        notion.pages.create({
          parent: { database_id: dbId },
          cover: { type: "external", external: { url: coverUrl } },
          properties,
        })
      );
    }
    synced++;
  });

  onProgress(`${synced} éléments Workshop synchronisés.`);
  return synced;
}

// ─── Groups sync ──────────────────────────────────────────────────────────────

async function syncGroups(
  notion: Client,
  dbId: string,
  groupIds: string[],
  onProgress: (msg: string) => void
): Promise<number> {
  if (groupIds.length === 0) return 0;

  const existing = await fetchAllDatabasePages(notion, dbId);
  const existingByGroupId = new Map<string, string>(); // groupId → pageId
  for (const page of existing) {
    const idProp = page.properties["Groupe ID"];
    if (idProp?.type === "rich_text") {
      const gid = idProp.rich_text.map((t: { plain_text: string }) => t.plain_text).join("");
      if (gid) existingByGroupId.set(gid, page.id);
    }
  }

  let synced = 0;
  await batchProcess(groupIds, 5, 600, async (groupId) => {
    const groupUrl = `https://steamcommunity.com/gid/${groupId}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = {
      Groupe: { title: [{ text: { content: `Groupe ${groupId}` } }] },
      "Groupe ID": { rich_text: [{ text: { content: groupId } }] },
      "URL Steam": { url: groupUrl },
    };

    const existingPageId = existingByGroupId.get(groupId);
    if (existingPageId) {
      await notionRetry(() =>
        notion.pages.update({ page_id: existingPageId, properties })
      );
    } else {
      await notionRetry(() =>
        notion.pages.create({ parent: { database_id: dbId }, properties })
      );
    }
    synced++;
  });

  onProgress(`${synced} groupes synchronisés.`);
  return synced;
}

// ─── Stats sync ───────────────────────────────────────────────────────────────

async function syncStats(
  notion: Client,
  dbId: string,
  statsData: Array<{ gameName: string; appId: number; stats: GameStatEntry[] }>,
  onProgress: (msg: string) => void
): Promise<number> {
  if (statsData.length === 0) return 0;

  const existing = await fetchAllDatabasePages(notion, dbId);
  const existingByKey = new Map<string, string>(); // "appId::statName" → pageId
  for (const page of existing) {
    const appIdProp = page.properties["App ID"];
    const statProp = page.properties["Stat"];
    const appId =
      appIdProp?.type === "number" ? (appIdProp.number ?? 0) : 0;
    const statName =
      statProp?.type === "title"
        ? statProp.title.map((t: { plain_text: string }) => t.plain_text).join("")
        : "";
    if (appId && statName) existingByKey.set(`${appId}::${statName}`, page.id);
  }

  const today = new Date().toISOString().split("T")[0];
  let total = 0;

  for (const { gameName, appId, stats } of statsData) {
    const capped = stats.slice(0, 100);
    await batchProcess(capped, 5, 800, async (stat) => {
      const key = `${appId}::${stat.name}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const properties: Record<string, any> = {
        Stat: { title: [{ text: { content: stat.name.slice(0, 2000) } }] },
        Jeu: { rich_text: [{ text: { content: gameName.slice(0, 2000) } }] },
        "App ID": { number: appId },
        Valeur: { number: stat.value },
        "Mis à jour": { date: { start: today } },
      };

      const existingPageId = existingByKey.get(key);
      if (existingPageId) {
        await notionRetry(() =>
          notion.pages.update({ page_id: existingPageId, properties })
        );
      } else {
        await notionRetry(() =>
          notion.pages.create({ parent: { database_id: dbId }, properties })
        );
      }
      total++;
    });
  }

  onProgress(`${total} statistiques synchronisées.`);
  return total;
}

// ─── Schema migration ─────────────────────────────────────────────────────────

async function addMissingDatabaseProperties(
  notion: Client,
  databaseId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  desiredSchema: Record<string, any>
): Promise<void> {
  try {
    const db = await notion.databases.retrieve({ database_id: databaseId });
    const existingKeys = new Set(Object.keys(db.properties));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newProperties: Record<string, any> = {};
    for (const [key, value] of Object.entries(desiredSchema)) {
      if (!existingKeys.has(key)) newProperties[key] = value;
    }
    if (Object.keys(newProperties).length > 0) {
      await notion.databases.update({
        database_id: databaseId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties: newProperties as any,
      });
    }
  } catch {
    // Non-critical — schema migration failure must not abort the sync
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function fetchAllDatabasePages(
  notion: Client,
  databaseId: string
): Promise<PageObjectResponse[]> {
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  let pageIndex = 0;

  do {
    const response = await notionRetry(() =>
      notion.databases.query({
        database_id: databaseId,
        page_size: 50,
        start_cursor: cursor,
      })
    );
    for (const result of response.results) {
      if (result.object === "page") {
        pages.push(result as PageObjectResponse);
      }
    }
    cursor = response.has_more
      ? (response.next_cursor ?? undefined)
      : undefined;
    pageIndex++;
    // Small delay between pagination requests to avoid rendering timeout
    if (cursor) await sleep(300);
  } while (cursor);

  return pages;
}

async function batchProcess<T>(
  items: T[],
  batchSize: number,
  delayMs: number,
  processor: (item: T) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(processor));
    if (i + batchSize < items.length) {
      await sleep(delayMs);
    }
  }
}

async function notionRetry<T>(fn: () => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 6;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const message = (err as { message?: string }).message ?? "";

      const isRateLimit = status === 429;
      // Notion "response time budget exceeded" comes as 504/502/503 or internal_server_error
      const isTimeout =
        status === 504 ||
        status === 502 ||
        status === 503 ||
        message.includes("response time budget") ||
        message.includes("timed out");

      if (isRateLimit || isTimeout) {
        const base = isRateLimit ? 2000 : 3000;
        const delay = base * Math.pow(2, attempt); // exponential backoff
        await sleep(Math.min(delay, 30000)); // cap at 30s
        continue;
      }
      throw err;
    }
  }
  return fn(); // final attempt, let it throw
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
