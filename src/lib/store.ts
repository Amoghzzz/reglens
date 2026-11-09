import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Small file-based store for logs and generated results (checklists, evaluation runs).
 * Locally this writes to data/runtime/. On hosts with a read-only project folder (such as Vercel)
 * it falls back to the system temp folder, which works but is not permanent.
 */

let resolvedDir: string | null = null;

export function runtimeDir(): string {
  if (resolvedDir) return resolvedDir;
  const candidates = [path.resolve(process.cwd(), 'data/runtime'), path.join(os.tmpdir(), 'reglens')];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      resolvedDir = dir;
      return dir;
    } catch {
      // try the next location
    }
  }
  throw new Error('No writable folder available for RegLens runtime data.');
}

function filePath(name: string): string {
  const full = path.join(runtimeDir(), name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  return full;
}

export function appendJsonl(name: string, record: unknown): void {
  try {
    fs.appendFileSync(filePath(name), JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.error(`Could not write ${name}:`, err);
  }
}

export function readJsonl<T>(name: string, limit = 500): T[] {
  try {
    const full = filePath(name);
    if (!fs.existsSync(full)) return [];
    const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as T;
        } catch {
          return null;
        }
      })
      .filter((x): x is T => x !== null);
  } catch {
    return [];
  }
}

export function readJson<T>(name: string): T | null {
  // Newest copy first (written on this server), then the copy shipped with the project. On Vercel the
  // project folder is read-only, so results generated locally (eval run, checklists) are read from the bundle.
  const shipped = path.resolve(process.cwd(), 'data/runtime', name);
  for (const full of [filePath(name), shipped]) {
    try {
      if (fs.existsSync(full)) return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
    } catch {
      // try the next copy
    }
  }
  return null;
}

export function writeJson(name: string, data: unknown): void {
  try {
    const full = filePath(name);
    fs.writeFileSync(`${full}.tmp`, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(`${full}.tmp`, full);
  } catch (err) {
    console.error(`Could not write ${name}:`, err);
  }
}

/** Reads a JSON file that ships with the project (e.g. data/eval/questions.json). */
export function readProjectJson<T>(relPath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8')) as T;
  } catch {
    return null;
  }
}
