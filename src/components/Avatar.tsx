interface Props {
  name: string;
  url?: string;
  emoji?: string;
  accent?: string;
  size?: number;
  ring?: boolean;
  /** 方形圆角（微信聊天风格） */
  square?: boolean;
}

/** 统一头像：优先真实图片（AI 生成 / 用户上传），否则回落到渐变字符头像 */
export default function Avatar({ name, url, emoji, accent = '#5b7cfa', size = 44, ring, square }: Props) {
  const radius = square ? 'rounded-[6px]' : 'rounded-full';
  const style = {
    width: size,
    height: size,
    background: `linear-gradient(135deg, ${accent}33, ${accent}11)`,
    borderColor: ring ? accent : 'rgba(255,255,255,.08)',
  };

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={`shrink-0 ${radius} object-cover`}
        style={{ ...style, borderWidth: 1 }}
      />
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center ${radius} border text-lg`}
      style={style}
      title={name}
    >
      {emoji ?? name.slice(0, 1)}
    </div>
  );
}
