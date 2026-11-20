import type { Asset, Crop, Grid, Settings } from "../../../shared/document";

export type QueueStatus =
  | "queued"
  | "decoding"
  | "rendering"
  | "done"
  | "error"
  | "canceled";

export type QueueMode = "frozen" | "follow";

/** 已完成的一份字符作品：永远与生成它时的完整规则、裁剪绑定 */
export interface QueueResult {
  grid: Grid;
  settings: Settings;
  crop: Crop;
  ruleVersion: number;
  /** 本次生成所属的批次（一次开始/重新生成共用同一快照） */
  batch: number;
  finishedAt: number;
  /** 成品使用的唯一文件名主干（含尺寸与 ID，防止同名覆盖） */
  fileStem: string;
}

export interface QueueItem {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  /** 未解码的原始来源：File 转为 dataURL 长期持有，保证可重复重试 */
  source: { kind: "file"; dataUrl: string } | { kind: "data"; dataUrl: string };
  status: QueueStatus;
  error: string | null;
  attempts: number;
  crop: Crop;
  /** 解码成功后保留；失败时为 null，可重试 */
  asset: Asset | null;
  /** 已完成结果；取消或失败不会清除它，仍可单独取出 */
  result: QueueResult | null;
  /** 最新公共规则版本：卡片据此显示“规则已更新，需重新生成” */
  ruleVersion: number;
  /** 裁剪或规则在完成后被改动 */
  stale: boolean;
}

export interface QueueStats {
  total: number;
  done: number;
  running: number;
  failed: number;
  canceled: number;
  pending: number;
}
