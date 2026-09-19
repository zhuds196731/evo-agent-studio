import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 语音输入：基于浏览器 Web Speech API（Chrome / Edge 原生支持，中文识别）。
 *
 * 稳健性修复：
 * 1. 保留启动识别前输入框已有的文字（新识别内容追加在其后）
 * 2. 麦克风预检：启动前显式 getUserMedia，权限被拒/无设备时给出明确错误
 * 3. 无结果看门狗：6 秒内未收到任何识别结果时给出诊断提示并自动停止
 *    （典型场景：嵌入 iframe 预览中麦克风被禁用、系统麦克风未授权）
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝：请点击浏览器地址栏的麦克风图标，选择"允许"后重试',
  'service-not-allowed': '语音服务被系统或策略禁用：请检查系统隐私设置中的麦克风权限',
  'no-speech': '没有检测到说话，请靠近麦克风再试一次',
  network: '语音识别服务网络异常，请检查网络后重试',
  'audio-capture': '未检测到麦克风设备，请确认麦克风已连接并启用',
  aborted: '',
};

export function useVoiceInput(options: {
  onText: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const { onText, onError } = options;
  const [supported] = useState(() => Boolean(getRecognitionCtor()));
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const watchdogRef = useRef<number | null>(null);
  /** 识别起始时输入框已有内容，新识别内容追加其后 */
  const baseRef = useRef('');
  const gotResultRef = useRef(false);

  const clearWatchdog = () => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  const stop = useCallback(() => {
    clearWatchdog();
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  const start = useCallback(
    async (baseText = '') => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) {
        onError?.('当前浏览器不支持语音输入，请使用 Chrome / Edge 浏览器');
        return;
      }

      // 0) 环境体检：嵌入 iframe 中浏览器会直接禁用麦克风，且永不弹出授权弹窗
      try {
        if (window.self !== window.top) {
          onError?.(
            '当前页面运行在嵌入预览框架中，浏览器会直接禁用麦克风（不会弹出授权弹窗）。请复制本页地址，在独立浏览器标签页打开后再使用语音输入。',
          );
          return;
        }
      } catch {
        /* 跨域访问 window.top 抛错说明确实在 iframe 中 */
        onError?.(
          '当前页面运行在嵌入预览框架中，浏览器会直接禁用麦克风（不会弹出授权弹窗）。请复制本页地址，在独立浏览器标签页打开后再使用语音输入。',
        );
        return;
      }

      // 0.5) 权限状态体检：已记住"拒绝"时浏览器不会再弹窗，需要引导用户手动解除
      try {
        const st = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (st.state === 'denied') {
          onError?.(
            '麦克风权限此前已被记住为"拒绝"，所以不会再弹出授权弹窗。请点击浏览器地址栏左侧的 🔒（或麦克风）图标 → 将麦克风改为"允许" → 刷新页面后重试。',
          );
          return;
        }
      } catch {
        /* 部分浏览器不支持 permissions.query，忽略继续 */
      }

      // 1) 麦克风预检：显式拿一次设备流，把权限/设备问题变成明确错误
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (e: any) {
        const name = String(e?.name ?? '');
        const msg =
          name === 'NotAllowedError'
            ? '麦克风权限被拒绝：请允许浏览器使用麦克风（地址栏左侧图标），或在系统设置中开启'
            : name === 'NotFoundError'
              ? '未检测到麦克风设备，请确认麦克风已连接'
              : name === 'NotReadableError'
                ? '麦克风被其他应用占用，请关闭占用麦克风的程序后重试'
                : `无法访问麦克风：${e?.message ?? name}`;
        onError?.(msg);
        return;
      }

      // 2) 停掉旧实例，记录输入框已有文字作为拼接基准
      if (recRef.current) {
        try {
          recRef.current.abort();
        } catch {
          /* ignore */
        }
      }
      baseRef.current = String(baseText ?? '');
      gotResultRef.current = false;

      const rec = new Ctor();
      recRef.current = rec;
      rec.lang = 'zh-CN';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => setListening(true);

      rec.onresult = (e: any) => {
        gotResultRef.current = true;
        clearWatchdog();
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const seg = e.results[i];
          const text = String(seg[0]?.transcript ?? '').trim();
          if (!text) continue;
          if (seg.isFinal) {
            baseRef.current = baseRef.current
              ? `${baseRef.current}${text}，`
              : `${text}，`;
          } else {
            interim = text;
          }
        }
        onText(`${baseRef.current}${interim}`);
      };

      rec.onerror = (e: any) => {
        const code = String(e?.error ?? 'unknown');
        const msg = ERROR_TEXT[code] || `语音识别错误：${code}`;
        clearWatchdog();
        setListening(false);
        if (msg) onError?.(msg);
      };

      rec.onend = () => {
        clearWatchdog();
        setListening(false);
      };

      try {
        rec.start();
        setListening(true);
      } catch (e) {
        onError?.(`语音启动失败：${(e as Error).message}`);
        return;
      }

      // 3) 无结果看门狗：6 秒无任何识别结果则提示诊断并停止
      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        if (!gotResultRef.current) {
          onError?.(
            '6 秒内未收到识别结果：请确认系统麦克风可用；若在嵌入预览窗口中，请用独立浏览器标签页打开应用后重试',
          );
          try {
            rec.abort();
          } catch {
            /* ignore */
          }
          setListening(false);
        }
      }, 6000);
    },
    [onError, onText],
  );

  const toggle = useCallback(
    (baseText = '') => {
      if (listening) stop();
      else void start(baseText);
    },
    [listening, start, stop],
  );

  /**
   * 卸载时必须停掉识别。
   * 连续识别（continuous）不会随组件卸载而结束：麦克风会一直被占用，
   * 回调还会打在已卸载的组件上。用 ref 持有最新的 stop，避免把它塞进依赖导致反复重启。
   */
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);
  useEffect(() => () => stopRef.current(), []);

  return { supported, listening, start, stop, toggle };
}
