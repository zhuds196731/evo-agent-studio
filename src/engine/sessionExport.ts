import type { AppState, Session } from '../types';
import { SCENE_LABEL } from './director';

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '会话';
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function participantNames(state: AppState, session: Session): string[] {
  return session.participantIds.map(
    (id) => state.personas.find((p) => p.id === id)?.name ?? state.sages.find((s) => s.id === id)?.name ?? id,
  );
}

/** 把一条会话渲染成 Markdown 文本，供导出或复制 */
export function sessionToMarkdown(session: Session, state: AppState): string {
  const lines: string[] = [];
  lines.push(`# ${session.title}`);
  lines.push('');
  lines.push(`- 场景：${SCENE_LABEL[session.scene]}`);
  lines.push(`- 参与者：${participantNames(state, session).join('、') || '（无）'}`);
  lines.push(`- 创建：${fmtTime(session.createdAt)}`);
  lines.push(`- 更新：${fmtTime(session.updatedAt)}`);
  lines.push(`- 消息：${session.messages.length} 条`);
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const m of session.messages) {
    if (m.role === 'system' || m.kind === 'notice') {
      lines.push(`> ${m.content}`);
      lines.push('');
      continue;
    }
    const side = m.side === 'A' || m.side === 'B' ? `（${m.side} 组）` : '';
    lines.push(`**${m.speakerName}${side}** · ${fmtTime(m.ts)}`);
    lines.push('');
    if (m.kind === 'image') {
      lines.push(`![图片](${m.content})`);
    } else {
      lines.push(m.content);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 导出会话为 .md 文件下载 */
export function downloadSessionMarkdown(session: Session, state: AppState): void {
  const md = sessionToMarkdown(session, state);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFileName(session.title)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
