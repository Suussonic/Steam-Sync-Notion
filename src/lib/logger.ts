/**
 * Sync logger — writes a timestamped log file under /logs/ in the project root.
 * Import syncLog() anywhere to append a line. Call initSyncLog() once at the
 * start of a sync run and closeSyncLog() at the end.
 */

import * as fs from "fs";
import * as path from "path";

let _stream: fs.WriteStream | null = null;
let _logPath: string | null = null;

/** Creates a new log file and returns its absolute path. */
export function initSyncLog(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(process.cwd(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  _logPath = path.join(dir, `sync-${ts}.log`);
  _stream = fs.createWriteStream(_logPath, { flags: "a", encoding: "utf8" });
  _writeLine(`${"=".repeat(70)}`);
  _writeLine(`SYNC DÉMARRÉ  ${new Date().toISOString()}`);
  _writeLine(`${"=".repeat(70)}`);
  return _logPath;
}

/** Appends a line to the current log file (and echoes to stdout). */
export function syncLog(msg: string): void {
  _writeLine(msg);
}

/** Closes the current log file stream. */
export function closeSyncLog(): void {
  if (_stream) {
    _writeLine(`${"=".repeat(70)}`);
    _writeLine(`SYNC TERMINÉ  ${new Date().toISOString()}`);
    _writeLine(`${"=".repeat(70)}`);
    _stream.end();
    _stream = null;
    _logPath = null;
  }
}

/** Returns the active log file path, or null if no sync is running. */
export function getLogPath(): string | null {
  return _logPath;
}

function _writeLine(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  _stream?.write(line);
  // Also print to server stdout so it appears in `next dev` terminal
  process.stdout.write(line);
}
