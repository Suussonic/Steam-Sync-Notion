import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import Image from "next/image";
import SyncButton from "./SyncButton";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();

  if (!session.isLoggedIn) {
    redirect("/");
  }

  const {
    profile,
    steamId,
    notionWorkspaceName,
    notionToken,
    lastSyncAt,
    lastSyncStats,
    notionSyncPageUrl,
  } = session;
  const { error } = await searchParams;

  const notionErrors: Record<string, string> = {
    notion_denied: "Autorisation Notion refusée.",
    notion_invalid: "Paramètres de retour Notion invalides.",
    notion_csrf: "Erreur de sécurité lors de la connexion Notion.",
    notion_token: "Impossible d'obtenir le token Notion.",
  };

  const bothConnected = !!notionToken;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gray-950 text-white p-8">
      <div className="flex flex-col items-center gap-6 rounded-xl bg-gray-900 p-8 ring-1 ring-white/10 w-full max-w-md">

        {/* Steam profile */}
        <div className="flex flex-col items-center gap-3 w-full">
          {profile?.avatarfull && (
            <Image
              src={profile.avatarfull}
              alt={profile.personaname}
              width={80}
              height={80}
              className="rounded-full ring-2 ring-white/20"
            />
          )}
          <div className="text-center">
            <h2 className="text-xl font-bold">
              {profile?.personaname ?? "Utilisateur Steam"}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500 font-mono">{steamId}</p>
          </div>
        </div>

        <div className="w-full h-px bg-white/10" />

        {/* Step 1 — Steam (always done here) */}
        <div className="w-full flex items-center gap-3 text-sm">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-500/20 text-green-400 text-xs font-bold">
            ✓
          </span>
          <span className="text-green-400 font-medium">Steam connecté</span>
        </div>

        {/* Step 2 — Notion */}
        <div className="w-full rounded-lg bg-gray-800 p-4 text-sm space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                notionToken
                  ? "bg-green-500/20 text-green-400"
                  : "bg-gray-600/50 text-gray-400"
              }`}
            >
              {notionToken ? "✓" : "2"}
            </span>
            <span className={notionToken ? "text-green-400 font-medium" : "text-gray-300"}>
              {notionToken
                ? `Notion connecté — ${notionWorkspaceName}`
                : "Connecter Notion"}
            </span>
          </div>

          {error && (
            <p className="text-red-400 text-xs">
              {notionErrors[error] ?? "Une erreur est survenue."}
            </p>
          )}

          {notionToken ? (
            <a
              href="/api/auth/notion/disconnect"
              className="block text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Déconnecter Notion
            </a>
          ) : (
            <a
              href="/api/auth/notion"
              className="inline-flex justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-gray-100 transition-colors"
            >
              Connecter Notion
            </a>
          )}
        </div>

        {/* Step 3 — Sync */}
        <div className="w-full rounded-lg bg-gray-800 p-4 space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                lastSyncAt
                  ? "bg-green-500/20 text-green-400"
                  : "bg-gray-600/50 text-gray-400"
              }`}
            >
              {lastSyncAt ? "✓" : "3"}
            </span>
            <span className={lastSyncAt ? "text-green-400 font-medium" : "text-gray-300 text-sm"}>
              {lastSyncAt ? "Synchronisation Notion" : "Synchroniser vers Notion"}
            </span>
          </div>

          {bothConnected ? (
            <SyncButton
              lastSyncAt={lastSyncAt}
              lastSyncStats={lastSyncStats}
              existingPageUrl={notionSyncPageUrl}
            />
          ) : (
            <p className="text-xs text-gray-500">
              Connecte Notion (étape 2) pour activer la synchronisation.
            </p>
          )}
        </div>

        {/* What gets synced — shown before first sync */}
        {!lastSyncAt && bothConnected && (
          <div className="w-full rounded-lg bg-gray-800/50 border border-white/5 p-4 text-xs text-gray-400 space-y-1">
            <p className="text-gray-300 font-medium mb-2">
              Ce qui sera créé dans Notion :
            </p>
            <p>Base de données — tous tes jeux (playtime, succès, statut...)</p>
            <p>Base de données — succès récemment débloqués</p>
            <p>Page — profil Steam avec statistiques</p>
          </div>
        )}

        <div className="w-full h-px bg-white/10" />

        <a
          href="/api/auth/logout"
          className="text-sm text-gray-500 hover:text-red-400 transition-colors"
        >
          Déconnecter Steam
        </a>
      </div>
    </main>
  );
}
