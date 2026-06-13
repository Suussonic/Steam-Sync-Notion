import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { syncSteamToNotion } from "@/lib/notion/sync";

/**
 * Allow up to 5 minutes — syncing a large Steam library takes time.
 * (Vercel Hobby limit is 60s; Pro/Enterprise can go higher.)
 */
export const maxDuration = 300;

// ─── POST /api/sync — streams sync progress via Server-Sent Events ────────────

export async function POST(_request: NextRequest) {
  const session = await getSession();

  if (!session.isLoggedIn || !session.steamId || !session.notionToken) {
    return NextResponse.json(
      { error: "Non authentifié. Connecte-toi avec Steam et Notion d'abord." },
      { status: 401 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Stream already closed
        }
      };

      try {
        const result = await syncSteamToNotion({
          notionToken: session.notionToken!,
          steamId: session.steamId!,
          steamProfile: session.profile!,
          existingPageId: session.notionSyncPageId,
          existingLibraryDbId: session.notionLibraryDbId,
          existingAchievementsDbId: session.notionAchievementsDbId,
          existingProfilePageId: session.notionProfilePageId,
          existingWishlistDbId: session.notionWishlistDbId,
          existingFriendsDbId: session.notionFriendsDbId,
          existingBadgesDbId: session.notionBadgesDbId,
          existingInventoryDbId: session.notionInventoryDbId,
          onProgress: (message) => send({ type: "progress", message }),
        });

        if (result.success) {
          send({
            type: "done",
            pageUrl: result.pageUrl,
            pageId: result.pageId,
            libraryDbId: result.libraryDbId,
            achievementsDbId: result.achievementsDbId,
            wishlistDbId: result.wishlistDbId,
            friendsDbId: result.friendsDbId,
            badgesDbId: result.badgesDbId,
            inventoryDbId: result.inventoryDbId,
            profilePageId: result.profilePageId,
            gamesCount: result.gamesCount,
            achievementsCount: result.achievementsCount,
            wishlistCount: result.wishlistCount,
            friendsCount: result.friendsCount,
            badgesCount: result.badgesCount,
            inventoryCount: result.inventoryCount,
          });
        } else {
          send({ type: "error", message: result.error ?? "Erreur inconnue" });
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Erreur inconnue",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}

// ─── PATCH /api/sync — persists page IDs into the session after sync ──────────

export async function PATCH(request: NextRequest) {
  const session = await getSession();

  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const {
    pageId,
    pageUrl,
    libraryDbId,
    achievementsDbId,
    wishlistDbId,
    friendsDbId,
    badgesDbId,
    inventoryDbId,
    profilePageId,
    gamesCount,
    achievementsCount,
  } = body as {
    pageId?: string;
    pageUrl?: string;
    libraryDbId?: string;
    achievementsDbId?: string;
    wishlistDbId?: string;
    friendsDbId?: string;
    badgesDbId?: string;
    inventoryDbId?: string;
    profilePageId?: string;
    gamesCount?: number;
    achievementsCount?: number;
  };

  if (pageId) session.notionSyncPageId = pageId;
  if (pageUrl) session.notionSyncPageUrl = pageUrl;
  if (libraryDbId) session.notionLibraryDbId = libraryDbId;
  if (achievementsDbId) session.notionAchievementsDbId = achievementsDbId;
  if (wishlistDbId) session.notionWishlistDbId = wishlistDbId;
  if (friendsDbId) session.notionFriendsDbId = friendsDbId;
  if (badgesDbId) session.notionBadgesDbId = badgesDbId;
  if (inventoryDbId) session.notionInventoryDbId = inventoryDbId;
  if (profilePageId) session.notionProfilePageId = profilePageId;
  session.lastSyncAt = new Date().toISOString();
  if (gamesCount !== undefined && achievementsCount !== undefined) {
    session.lastSyncStats = { games: gamesCount, achievements: achievementsCount };
  }

  await session.save();

  return NextResponse.json({ ok: true });
}
