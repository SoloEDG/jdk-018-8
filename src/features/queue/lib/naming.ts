/**
 * 队列内唯一文件名：基础名 + 尺寸 + 短 ID。
 * 同名文件得到不同 ID；同名且同尺寸同样保留不同 ID，绝不互相覆盖。
 */
export function safeBase(name: string): string {
  const stripped = name.replace(/\.[^.]+$/, "");
  const cleaned = stripped.replace(/[^\p{L}\p{N}_-]/gu, "_") || "art";
  return cleaned;
}

export function shortId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(16).slice(2, 10).padStart(8, "0");
}

export function buildFileStem(
  name: string,
  width: number,
  height: number,
  id: string,
): string {
  return `${safeBase(name)}-${width}x${height}-${id}`;
}

export function withExt(stem: string, ext: string): string {
  return `${stem}.${ext}`;
}

/** 汇总清单里给人看的原始文件名，保留扩展名 */
export function displayName(name: string): string {
  return name || "untitled";
}
