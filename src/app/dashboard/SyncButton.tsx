"use client";

import { useState } from "react";

interface Props {
  disabled?: boolean;
  lastSyncAt?: string;
  lastSyncStats?: { games: number; achievements: number };
  existingPageUrl?: string;
}

type Status = "idle" | "syncing" | "done" | "error";

export default function SyncButton({
  disabled,
  lastSyncAt,
  lastSyncStats,
  existingPageUrl,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState("");
  const [pageUrl, setPageUrl] = useState(existingPageUrl ?? "");
  const [syncStats, setSyncStats] = useState(lastSyncStats);
  const [error, setError] = useState("");

  const handleSync = async () => {
    setStatus("syncing");
    setProgress("Connexion au serveur...");
    setError("");

    try {
      const res = await fetch("/api/sync", { method: "POST" });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          (json as { error?: string }).error ?? `Erreur HTTP ${res.status}`
        );
      }

      if (!res.body) throw new Error("Aucun flux de données reçu.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Holds the done payload until we save it to the session
      let donePayload: Record<string, unknown> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (event.type === "progress") {
            setProgress(event.message as string);
          } else if (event.type === "done") {
            donePayload = event;
            setPageUrl((event.pageUrl as string) ?? "");
            setSyncStats({
              games: (event.gamesCount as number) ?? 0,
              achievements: (event.achievementsCount as number) ?? 0,
            });
            setStatus("done");
          } else if (event.type === "error") {
            throw new Error(event.message as string);
          }
        }
      }

      // Persist page IDs + stats to the session via PATCH
      if (donePayload) {
        await fetch("/api/sync", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(donePayload),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setStatus("error");
    }
  };

  const isSyncing = status === "syncing";

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Sync button */}
      <button
        onClick={handleSync}
        disabled={disabled || isSyncing}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSyncing ? (
          <>
            <Spinner />
            Synchronisation en cours...
          </>
        ) : (
          <>
            <SyncIcon />
            {lastSyncAt ? "Re-synchroniser vers Notion" : "Synchroniser vers Notion"}
          </>
        )}
      </button>

      {/* Progress message */}
      {isSyncing && progress && (
        <p className="text-xs text-gray-400 text-center animate-pulse">
          {progress}
        </p>
      )}
      {isSyncing && (
        <p className="text-xs text-gray-500 text-center">
          Cela peut prendre 1 à 3 minutes selon la taille de ta bibliothèque.
        </p>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="rounded-lg bg-red-900/40 border border-red-700/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Success */}
      {status === "done" && (
        <div className="rounded-lg bg-green-900/40 border border-green-700/40 p-3 text-sm text-green-300 flex flex-col gap-2">
          <p className="font-semibold">Synchronisation terminée !</p>
          {syncStats && (
            <p className="text-green-400/80">
              {syncStats.games} jeux · {syncStats.achievements} succès
            </p>
          )}
          {pageUrl && (
            <a
              href={pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-white underline underline-offset-2 hover:text-green-300 transition-colors"
            >
              Ouvrir dans Notion →
            </a>
          )}
        </div>
      )}

      {/* Last sync info (idle state) */}
      {status === "idle" && lastSyncAt && (
        <div className="rounded-lg bg-gray-800 p-3 text-xs text-gray-400 flex flex-col gap-1">
          <p>
            Dernière sync :{" "}
            {new Date(lastSyncAt).toLocaleString("fr-FR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          {lastSyncStats && (
            <p>
              {lastSyncStats.games} jeux · {lastSyncStats.achievements} succès
            </p>
          )}
          {existingPageUrl && (
            <a
              href={existingPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Ouvrir la page Notion →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 fill-current"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.606 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.497 1.009 2.455-.397.957-1.494 1.41-2.455 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
    </svg>
  );
}
