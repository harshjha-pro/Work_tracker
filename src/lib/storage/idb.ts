// Minimal IndexedDB wrapper (E3). Two object stores: the SQLite database file,
// and attachment bodies (C7).

export const IDB_NAME = 'qepex-work-tracker';
export const STORE_DB = 'sqlite';
export const STORE_FILES = 'files';

let dbp: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE_DB)) d.createObjectStore(STORE_DB);
      if (!d.objectStoreNames.contains(STORE_FILES)) d.createObjectStore(STORE_FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const idbGet = <T>(store: string, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbPut = (store: string, key: string, value: unknown) => tx(store, 'readwrite', (s) => s.put(value, key));
export const idbDelete = (store: string, key: string) => tx(store, 'readwrite', (s) => s.delete(key));
export const idbKeys = (store: string) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());

/** Close and forget the cached connection (tests, and before deleting the database). */
export function idbReset() {
  const p = dbp;
  dbp = null;
  void p?.then((d) => d.close()).catch(() => undefined);
}
