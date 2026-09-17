/**
 * 记事本媒体存储：图片、语音、视频的二进制本体保存在 IndexedDB。
 * localStorage 只保留轻量元数据，避免大文件导致应用状态写满。
 */

export interface NotepadMediaRecord {
  id: string;
  noteId: string;
  blob: Blob;
  createdAt: string;
}

const DB_NAME = 'evo-notepad';
const STORE = 'media-files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export const notepadMediaStore = {
  async put(record: NotepadMediaRecord): Promise<void> {
    await withStore('readwrite', (store) => store.put(record));
  },

  async get(id: string): Promise<NotepadMediaRecord | undefined> {
    return withStore<NotepadMediaRecord | undefined>('readonly', (store) => store.get(id));
  },

  async getAll(): Promise<NotepadMediaRecord[]> {
    return withStore<NotepadMediaRecord[]>('readonly', (store) => store.getAll());
  },

  async listByNote(noteId: string): Promise<NotepadMediaRecord[]> {
    const all = await this.getAll();
    return all.filter((item) => item.noteId === noteId);
  },

  async remove(id: string): Promise<void> {
    await withStore('readwrite', (store) => store.delete(id));
  },

  async removeByNote(noteId: string): Promise<void> {
    const all = await this.getAll();
    const ids = all.filter((item) => item.noteId === noteId).map((item) => item.id);
    for (const id of ids) {
      await withStore('readwrite', (store) => store.delete(id));
    }
  },

  async clear(): Promise<void> {
    await withStore('readwrite', (store) => store.clear());
  },
};

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
