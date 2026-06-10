import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import Image from "next/image";

export default async function Dashboard() {
  const session = await getSession();

  if (!session.isLoggedIn) {
    redirect("/");
  }

  const { profile, steamId } = session;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gray-950 text-white p-8">
      <div className="flex flex-col items-center gap-4 rounded-xl bg-gray-900 p-8 ring-1 ring-white/10 w-full max-w-md">
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

        <div className="mt-4 w-full rounded-lg bg-gray-800 p-4 text-sm text-gray-300 space-y-1">
          <p>Authentification Steam réussie</p>
          <p className="text-gray-500">Prochaine étape : connecter ton workspace Notion</p>
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
