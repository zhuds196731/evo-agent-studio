/** 把用户上传的真人照片压缩为头像尺寸，避免 localStorage 被大图撑爆 */
export async function compressToAvatar(file: File, size = 256): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解析失败'));
    img.src = src;
  });
}

/** 拼装二次元高清形象的生成提示词，供多模态生成能力使用 */
export function buildAvatarPrompt(opts: {
  name: string;
  position: string;
  department: string;
  base: string;
  style: string;
}): string {
  return [
    '二次元半写实插画风格人物立绘头像，细腻高清，柔和高光，电影感布光',
    `人物身份：${opts.position}（${opts.department}）`,
    `外观气质：${opts.base}`,
    `画风：${opts.style || '日系赛璐璐上色 + 轻厚涂，皮肤通透，发丝细节丰富'}`,
    '构图：胸像居中，纯色渐变背景，主体清晰，正面微侧，眼神有神',
    '要求：不出现文字水印，不出现变形手指，比例自然，整体高级质感',
  ].join('；');
}
