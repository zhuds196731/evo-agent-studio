import type { ChatAttachment } from '../types';
import { formatBytes } from './knowledge';

/**
 * Chat attachment blobs live in IndexedDB so large media files do not bloat
 * the app state in localStorage. ChatMessage only keeps lightweight metadata.
 */

export interface ChatAttachmentRecord {
  id: string;
  blob: Blob;
  createdAt: string;
}

const DB_NAME = 'evo-chat-attachments';
const STORE = 'attachments';
const TEXT_EXTRACT_LIMIT = 12_000;
const TOTAL_TEXT_LIMIT = 32_000;

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

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

function createId(): string {
  return `chat-file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isTextLike(attachment: ChatAttachment): boolean {
  const mime = attachment.mime.toLowerCase();
  const name = attachment.name.toLowerCase();
  return (
    mime.startsWith('text/') ||
    /^(application\/(json|xml|javascript|x-yaml))$/i.test(mime) ||
    /\.(txt|md|markdown|csv|tsv|json|xml|yml|yaml|log|ini|conf|srt|vtt)$/i.test(name)
  );
}

export const chatAttachmentStore = {
  async put(file: File): Promise<ChatAttachment> {
    const id = createId();
    const record: ChatAttachmentRecord = {
      id,
      blob: file,
      createdAt: new Date().toISOString(),
    };
    await withStore('readwrite', (store) => store.put(record));
    return {
      id,
      name: file.name || id,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      createdAt: record.createdAt,
    };
  },

  async get(id: string): Promise<ChatAttachmentRecord | undefined> {
    return withStore<ChatAttachmentRecord | undefined>('readonly', (store) => store.get(id));
  },

  async remove(id: string): Promise<void> {
    await withStore('readwrite', (store) => store.delete(id));
  },

  async removeMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      await withStore('readwrite', (store) => store.delete(id));
    }
  },

  async clear(): Promise<void> {
    await withStore('readwrite', (store) => store.clear());
  },
};

export function attachmentTypeLabel(attachment: ChatAttachment): string {
  const mime = attachment.mime.toLowerCase();
  if (mime.startsWith('image/')) return '图片';
  if (mime.startsWith('audio/')) return '音频';
  if (mime.startsWith('video/')) return '视频';
  if (mime === 'application/pdf' || /\.pdf$/i.test(attachment.name)) return 'PDF';
  if (/^(text\/|application\/(json|xml|javascript|x-yaml))/i.test(mime)) return '文本';
  if (/\.(docx?|rtf)$/i.test(attachment.name)) return '文档';
  if (/\.(xlsx?|csv|tsv)$/i.test(attachment.name)) return '表格';
  if (/\.(zip|7z|rar|tar|gz)$/i.test(attachment.name)) return '压缩包';
  return '文件';
}

export function attachmentEmoji(attachment: ChatAttachment): string {
  const label = attachmentTypeLabel(attachment);
  if (label === '图片') return '🖼️';
  if (label === '音频') return '🎧';
  if (label === '视频') return '🎬';
  if (label === 'PDF') return '📄';
  if (label === '文本') return '📝';
  if (label === '文档') return '📃';
  if (label === '表格') return '📊';
  if (label === '压缩包') return '🗄️';
  return '📎';
}

/** Open or download an attachment. The browser chooses the appropriate handler. */
export async function openAttachment(attachment: ChatAttachment): Promise<void> {
  const record = await chatAttachmentStore.get(attachment.id);
  if (!record) throw new Error('附件已不存在');

  const url = URL.createObjectURL(record.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = attachment.name;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function readTextAttachment(
  attachment: ChatAttachment,
  limit: number,
): Promise<string | null> {
  if (!isTextLike(attachment) || limit <= 0) return null;
  try {
    const record = await chatAttachmentStore.get(attachment.id);
    if (!record) return null;
    const text = await record.blob.slice(0, Math.min(record.blob.size, limit * 4)).text();
    return text.length > limit ? `${text.slice(0, limit)}\n…（文本过长，已截断）` : text;
  } catch {
    return null;
  }
}

/**
 * Build a compact model prompt. Text-like files are readable; other file types
 * are declared by metadata so unsupported binary content is never fabricated.
 */
export async function buildAttachmentContext(
  attachments: ChatAttachment[],
  totalLimit = TOTAL_TEXT_LIMIT,
): Promise<string> {
  if (!attachments.length) return '';

  const sections: string[] = [];
  let remaining = totalLimit;

  for (const [index, attachment] of attachments.entries()) {
    const label = `${index + 1}. ${attachment.name}（${attachmentTypeLabel(
      attachment,
    )}，${attachment.mime || '未知类型'}，${formatBytes(attachment.size)}）`;
    const text = await readTextAttachment(attachment, Math.min(remaining, TEXT_EXTRACT_LIMIT));
    if (text) {
      remaining = Math.max(0, remaining - text.length);
      sections.push(`${label}\n文本内容：\n${text}`);
    } else {
      sections.push(`${label}`);
    }
  }

  return [
    '[用户上传附件]',
    '用户在本次消息中上传了以下附件。可使用文本附件中的内容；其他附件只可参考其名称与类型，不要编造其内容。',
    ...sections,
  ].join('\n');
}

export function attachmentNames(attachments: ChatAttachment[] | undefined): string {
  return (attachments ?? []).map((item) => item.name).join('、');
}
