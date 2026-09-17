/**
 * 知识库：本地文件资料管理。
 * - 预置分类目录，用户可自行增删分类
 * - 文件以 base64 存于本机 localStorage（软件运行时设定的本机存储位置），
 *   不经过任何服务器，保证信息不外泄
 * - 浏览器环境单 key 容量有限（约 5MB），单文件上限 2MB，超出给出提示
 */

const CAT_KEY = 'evo/kb-categories';
const FILE_KEY = 'evo/kb-files';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface KnowledgeCategory {
  id: string;
  name: string;
  builtin: boolean;
}

export interface KnowledgeFile {
  id: string;
  categoryId: string;
  name: string;
  mime: string;
  size: number;
  /** base64 data URL */
  dataUrl: string;
  uploadedAt: string;
}

export const PRESET_CATEGORIES: KnowledgeCategory[] = [
  { id: 'kb-strategy', name: '战略与管理', builtin: true },
  { id: 'kb-marketing', name: '市场与营销', builtin: true },
  { id: 'kb-tech', name: '技术与研发', builtin: true },
  { id: 'kb-finance', name: '财务与税务', builtin: true },
  { id: 'kb-hr', name: '人事与制度', builtin: true },
  { id: 'kb-notes', name: '个人笔记', builtin: true },
];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const knowledgeStore = {
  /** 全部分类（预置 + 自定义），确保预置分类始终存在 */
  categories(): KnowledgeCategory[] {
    const saved = read<KnowledgeCategory[]>(CAT_KEY, []);
    const map = new Map(PRESET_CATEGORIES.map((c) => [c.id, c]));
    for (const c of saved) map.set(c.id, c);
    return [...map.values()];
  },

  addCategory(name: string): KnowledgeCategory | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const list = this.categories();
    if (list.some((c) => c.name === trimmed)) return null;
    const cat: KnowledgeCategory = {
      id: `kb-cat-${Date.now().toString(36)}`,
      name: trimmed,
      builtin: false,
    };
    write(CAT_KEY, [...list.filter((c) => !c.builtin || PRESET_CATEGORIES.some((p) => p.id === c.id)), cat]);
    return cat;
  },

  /** 删除分类；builtin 仅允许删除其自定义部分（预置分类不可删除） */
  removeCategory(id: string): boolean {
    if (PRESET_CATEGORIES.some((p) => p.id === id)) return false;
    const list = this.categories().filter((c) => c.id !== id);
    write(CAT_KEY, list.filter((c) => !PRESET_CATEGORIES.some((p) => p.id === c.id)));
    // 分类下的文件一并删除
    const files = this.files().filter((f) => f.categoryId !== id);
    write(FILE_KEY, files);
    return true;
  },

  files(): KnowledgeFile[] {
    return read<KnowledgeFile[]>(FILE_KEY, []).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  },

  filesBy(categoryId: string): KnowledgeFile[] {
    return this.files().filter((f) => f.categoryId === categoryId);
  },

  /** 上传文件：读取为 base64 存本机，超限返回失败清单 */
  async addFiles(
    fileList: FileList | File[],
    categoryId: string,
  ): Promise<{ added: KnowledgeFile[]; failed: { name: string; reason: string }[] }> {
    const added: KnowledgeFile[] = [];
    const failed: { name: string; reason: string }[] = [];

    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_BYTES) {
        failed.push({ name: file.name, reason: '超过单文件 2MB 上限' });
        continue;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(new Error('读取失败'));
          reader.readAsDataURL(file);
        });
        const row: KnowledgeFile = {
          id: `kb-file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          categoryId,
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
          uploadedAt: new Date().toISOString(),
        };
        const all = [...this.files(), row];
        if (!write(FILE_KEY, all)) {
          failed.push({ name: file.name, reason: '本机存储空间不足，请先清理旧文件' });
          continue;
        }
        added.push(row);
      } catch {
        failed.push({ name: file.name, reason: '文件读取失败' });
      }
    }
    return { added, failed };
  },

  removeFile(id: string) {
    write(FILE_KEY, this.files().filter((f) => f.id !== id));
  },

  /** 文本类文件预览：解码 base64 */
  readText(file: KnowledgeFile): string | null {
    if (!/^(text\/|application\/(json|xml|javascript))/i.test(file.mime) && !/\.(md|txt|csv|json|log)$/i.test(file.name)) {
      return null;
    }
    try {
      return decodeURIComponent(escape(atob(file.dataUrl.split(',')[1] ?? '')));
    } catch {
      return null;
    }
  },

  isImage(file: KnowledgeFile): boolean {
    return /^image\//i.test(file.mime);
  },

  /** 下载到本机 */
  download(file: KnowledgeFile) {
    const a = document.createElement('a');
    a.href = file.dataUrl;
    a.download = file.name;
    a.click();
  },

  usage(): { count: number; bytes: number } {
    const files = this.files();
    return { count: files.length, bytes: files.reduce((n, f) => n + Math.round(f.size * 1.37), 0) };
  },

  clear() {
    write(FILE_KEY, []);
  },
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
