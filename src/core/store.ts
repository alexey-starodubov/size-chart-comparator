import { parseChart, type Chart } from './chart-editor';

// Проект хранится в IndexedDB «size-chart-comparator». Проект небольшой (только текст), поэтому на закрытии
// вкладки он целиком синхронно копируется в localStorage: запись в IndexedDB при закрытии может не успеть.

const DB = 'size-chart-comparator';
const STORE = 'charts';
const KEY = 'current';
export const BACKUP_KEY = 'scc.v1.unsaved';

export interface ChartStore {
  load(): Promise<Chart | null>;
  save(p: Chart): Promise<void>;
}

export class MemoryStore implements ChartStore {
  private p: Chart | null = null;
  async load() {
    return this.p ? structuredClone(this.p) : null;
  }
  async save(p: Chart) {
    this.p = structuredClone(p);
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB недоступна'));
    req.onblocked = () => reject(new Error('IndexedDB заблокирована другой вкладкой'));
  });
}

export class IdbStore implements ChartStore {
  private db: Promise<IDBDatabase> | null = null;
  private conn() {
    this.db ??= openDb().catch((e) => {
      this.db = null;
      throw e;
    });
    return this.db;
  }
  async load(): Promise<Chart | null> {
    const db = await this.conn();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!raw) return null;
    const r = parseChart(raw);
    return r.ok ? r.chart : null;
  }
  async save(p: Chart): Promise<void> {
    const db = await this.conn();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(p, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Не удалось сохранить проект'));
      tx.onabort = () => reject(tx.error ?? new Error('Сохранение прервано'));
    });
  }
}

/** Более новая из двух версий проекта: из IndexedDB и из резервной копии закрытой вкладки. */
export function newer(a: Chart | null, backupRaw: string | null): { chart: Chart | null; fromBackup: boolean } {
  if (!backupRaw) return { chart: a, fromBackup: false };
  try {
    const r = parseChart(JSON.parse(backupRaw));
    if (r.ok && (!a || r.chart.updatedAt > a.updatedAt)) return { chart: r.chart, fromBackup: true };
  } catch {
    /* повреждённая копия — игнорируем */
  }
  return { chart: a, fromBackup: false };
}
