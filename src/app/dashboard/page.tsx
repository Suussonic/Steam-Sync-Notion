import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import Image from "next/image";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();

  if (!session.isLoggedIn) {
    redirect("/");
  }

  const { profile, steamId, notionWorkspaceName, notionToken } = session;
  const { error } = await searchParams;

  const notionErrors: Record<string, string> = {
    notion_denied: "Autorisation Notion refusée.",
    notion_invalid: "Paramètres de retour Notion invalides.",
    notion_csrf: "Erreur de sécurité lors de la connexion Notion.",
    notion_token: "Impossible d'obtenir le token Notion.",
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gray-950 text-white p-8">
      <div className="flex flex-col items-center gap-4 rounded-xl bg-gray-900 p-8 ring-1 ring-white/10 w-full max-w-md">

        {/* Profil Steam */}
        {profile?.avatarfull && (
          <Image
            src={profile.avatarfull}
            alt={profile.personaname}
            width={96}
            height={96}
            className="rounded-full ring-2 ring-white/20"
          />
        )}
        <div className="text-center">
          <h2 className="text-2xl font-bold">{profile?.personaname ?? "Utilisateur Steam"}</h2>
          <p className="mt-1 text-xs text-gray-500 font-mono">{steamId}</p>
        </div>

        {/* Statut Notion */}
        <div className="mt-2 w-full rounded-lg bg-gray-800 p-4 text-sm space-y-3">
          {error && (
            <p className="text-red-400">{notionErrors[error] ?? "Une erreur est survenue."}</p>
          )}
          {notionToken ? (
            <div className="flex flex-col gap-1">
              <p className="text-green-400 font-medium">Notion connecté</p>
              <p className="text-gray-400">{notionWorkspaceName}</p>
              <a
                href="/api/auth/notion/disconnect"
                className="mt-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
              >
                Déconnecter Notion
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-gray-400">Notion non connecté</p>
              <a
                href="/api/auth/notion"
                className="inline-flex justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-gray-100 transition-colors"
              >
                Connecter Notion
              </a>
            </div>
          )}
        </div>

        <a
          href="/api/auth/logout"
          className="mt-2 text-sm text-gray-500 hover:text-red-400 transition-colors"
        >
          Déconnecter Steam
        </a>
      </div>
    </main>
  );
}
