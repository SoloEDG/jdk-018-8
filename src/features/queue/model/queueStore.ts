import { computed, watch } from "vue";
import type { Asset, Crop, Settings } from "../../../shared/document";
import { decodeImage } from "../../source/lib/decode";
import { generateFrom } from "../../mapping/model/generate";
import { download } from "../../export/lib/download";
import { textContent } from "../../export/lib/text";
import { drawGrid } from "../../preview/lib/draw";
import { Semaphore } from "../lib/semaphore";
import { buildBundleZip } from "../lib/bundle";
import { buildFileStem, shortId, withExt } from "../lib/naming";
import type { QueueItem, QueueMode, QueueStats, QueueStatus } from "./types";

export const MAX_CONCURRENCY = 4;
const ACCEPTED = /^image\/(png|jpeg|webp)$/;
const MAX_SIZE = 20 * 1024 * 1024;

export interface QueueStore {
  items: QueueItem[];
  state: {
    mode: QueueMode;
    concurrency: number;
    running: boolean;
    exporting: boolean;
    selectedId: string | null;
    ruleVersion: number;
    batch: number;
  };
  notice: (msg: string) => void;
  doc: {
    asset: Asset | null;
    crop: Crop;
    settings: Settings;
  };
}

interface RejectedFile {
  name: string;
  reason: string;
}

export function createQueueStore(store: QueueStore) {
  const cancelToken = { run: 0 };

  const stats = computed<QueueStats>(() => {
    const s: QueueStats = {
      total: store.items.length,
      done: 0,
      running: 0,
      failed: 0,
      canceled: 0,
      pending: 0,
    };
    for (const item of store.items) {
      if (item.status === "done") s.done++;
      else if (item.status === "decoding" || item.status === "rendering")
        s.running++;
      else if (item.status === "error") s.failed++;
      else if (item.status === "canceled") s.canceled++;
      else s.pending++;
    }
    return s;
  });

  const selected = computed(
    () => store.items.find((i) => i.id === store.state.selectedId) ?? null,
  );

  function bumpRuleVersion() {
    store.state.ruleVersion++;
  }

  // 公共规则版本提升后，未开始的项目跟随新版本；已完成项目只标记 stale，旧成品不动
  watch(
    () => store.state.ruleVersion,
    (version, old) => {
      if (version === old) return;
      for (const item of store.items) {
        if (item.status === "queued") item.ruleVersion = version;
        else if (item.status === "done") item.stale = true;
      }
    },
  );

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.readAsDataURL(file);
    });
  }

  function validate(file: File): string | null {
    if (!ACCEPTED.test(file.type)) return "仅支持 PNG / JPEG / WEBP";
    if (file.size > MAX_SIZE) return "超过 20 MB 限制";
    return null;
  }

  async function enqueueFiles(files: File[]): Promise<RejectedFile[]> {
    const rejected: RejectedFile[] = [];
    for (const file of files) {
      const reason = validate(file);
      if (reason) {
        rejected.push({ name: file.name, reason });
        continue;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        const id = shortId();
        store.items.push({
          id,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          source: { kind: "file", dataUrl },
          status: "queued",
          error: null,
          attempts: 0,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          asset: null,
          result: null,
          ruleVersion: store.state.ruleVersion,
          stale: false,
        });
      } catch {
        rejected.push({ name: file.name, reason: "文件读取失败" });
      }
    }
    if (store.items.length && !store.state.selectedId) select(store.items[0]!.id);
    return rejected;
  }

  async function enqueueDataUrl(
    dataUrl: string,
    name: string,
    size = 0,
    type = "image/png",
  ): Promise<string | null> {
    const id = shortId();
    store.items.push({
      id,
      fileName: name,
      fileSize: size,
      fileType: type,
      source: { kind: "data", dataUrl },
      status: "queued",
      error: null,
      attempts: 0,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      asset: null,
      result: null,
      ruleVersion: store.state.ruleVersion,
      stale: false,
    });
    if (!store.state.selectedId) select(id);
    return null;
  }

  function select(id: string) {
    const item = store.items.find((i) => i.id === id);
    if (!item) return;
    store.state.selectedId = id;
    if (item.asset) {
      if (store.doc.asset?.url.startsWith("blob:"))
        URL.revokeObjectURL(store.doc.asset.url);
      store.doc.asset = item.asset;
      store.doc.crop = { ...item.crop };
    }
  }

  /**
   * 选中排队项目时按需解码，供裁剪面板使用。
   * 同样经过并发信号量；失败则标记错误，不会阻塞队列，可重试。
   */
  const decodeSemaphore = new Semaphore(MAX_CONCURRENCY);
  async function ensureDecoded(id: string) {
    const item = store.items.find((i) => i.id === id);
    if (
      !item ||
      item.asset ||
      item.status === "decoding" ||
      store.state.running
    )
      return;
    item.status = "decoding";
    item.error = null;
    await decodeSemaphore.acquire();
    try {
      const asset = await decodeImage(item.source.dataUrl, item.fileName);
      item.asset = asset;
      // 等待期间队列可能已经启动，状态交给 run 流程，不在这里覆盖
      if (store.state.running) return;
      item.status = "queued";
      if (store.state.selectedId === id) {
        store.doc.asset = asset;
        store.doc.crop = { ...item.crop };
      }
    } catch (e) {
      if (store.state.running) return;
      item.status = "error";
      item.error = e instanceof Error ? e.message : "图片损坏，无法解码";
    } finally {
      decodeSemaphore.release();
    }
  }

  /** 选中项的裁剪写回自身；已完成的旧成品保留并标记为待重新生成 */
  function syncCropFromDoc() {
    const item = selected.value;
    if (!item || !store.doc.asset) return;
    if (item.asset !== store.doc.asset) return;
    const c = store.doc.crop;
    if (
      c.x === item.crop.x &&
      c.y === item.crop.y &&
      c.width === item.crop.width &&
      c.height === item.crop.height
    )
      return;
    item.crop = { ...c };
    if (item.status === "done") item.stale = true;
  }

  function remove(id: string) {
    const idx = store.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const item = store.items[idx]!;
    if (
      item.status === "decoding" ||
      item.status === "rendering"
    )
      return; // 运行中的项目先取消整批
    if (
      item.asset === store.doc.asset &&
      store.doc.asset?.url.startsWith("blob:")
    ) {
      URL.revokeObjectURL(store.doc.asset.url);
    }
    store.items.splice(idx, 1);
    if (store.state.selectedId === id) {
      const next = store.items[0];
      store.state.selectedId = next?.id ?? null;
      if (next?.asset) {
        store.doc.asset = next.asset;
        store.doc.crop = { ...next.crop };
      } else {
        // 下一项尚未解码，清空单图编辑区，避免裁剪面板残留旧图
        store.doc.asset = null;
        store.doc.crop = { x: 0, y: 0, width: 1, height: 1 };
      }
    }
  }

  function clearFinished() {
    const remaining: QueueItem[] = [];
    for (const item of store.items) {
      if (item.status === "done" || item.status === "error" || item.status === "canceled") {
        if (
          item.asset === store.doc.asset &&
          store.doc.asset?.url.startsWith("blob:")
        ) {
          URL.revokeObjectURL(store.doc.asset.url);
        }
      } else {
        remaining.push(item);
      }
    }
    store.items.splice(0, store.items.length, ...remaining);
    if (!remaining.find((i) => i.id === store.state.selectedId)) {
      store.state.selectedId = remaining[0]?.id ?? null;
    }
  }

  function resetCrop(id: string) {
    const item = store.items.find((i) => i.id === id);
    if (!item) return;
    item.crop = { x: 0, y: 0, width: 1, height: 1 };
    if (item.id === store.state.selectedId) store.doc.crop = { ...item.crop };
    if (item.status === "done") item.stale = true;
  }

  function markQueued(item: QueueItem) {
    item.status = "queued";
    item.error = null;
    item.stale = false;
    item.ruleVersion = store.state.ruleVersion;
  }

  function retry(id: string) {
    const item = store.items.find((i) => i.id === id);
    if (!item || store.state.running) return;
    if (item.status !== "error" && item.status !== "canceled") return;
    markQueued(item);
    void run([item], { silent: true });
  }

  /**
   * 核心执行器。
   * frozen：启动瞬间对公共规则做一次深快照，整批共用，运行中改密度不影响本批；
   * follow：不做整批快照，每项开工时读取当前规则与 ruleVersion，
   *         运行中改密度会让随后开工的项目立刻使用新参数（可观察）。
   * 无论哪种模式，单个成品都绑定一份完整 Settings 快照，绝不新旧混用。
   */
  async function run(
    scope: QueueItem[] | null,
    opts: { silent?: boolean; snapshot?: Settings; snapshotVersion?: number } = {},
  ) {
    if (store.state.running) return;
    const targets =
      scope ??
      store.items.filter(
        (i) => i.status === "queued" || i.status === "decoding",
      );
    // 按需解码可能遗留 decoding 状态，统一收回队列（asset 已缓存则不会重复解码）
    for (const t of targets) if (t.status === "decoding") t.status = "queued";
    if (!targets.length) {
      if (!opts.silent) store.notice("没有等待处理的项目");
      return;
    }
    const token = ++cancelToken.run;
    store.state.running = true;
    const batch = ++store.state.batch;
    // 本次运行认领过的项目：失败项不会在同一轮被自动重复认领，
    // 重试由用户显式触发（retry / reapply / 再次开始）
    const claimed = new Set<string>();
    // 显式快照（重应用批次）优先；否则按队列模式决定
    const frozen: Settings | null =
      opts.snapshot ??
      (store.state.mode === "frozen"
        ? JSON.parse(JSON.stringify(store.doc.settings))
        : null);
    const frozenVersion = opts.snapshotVersion ?? store.state.ruleVersion;
    const semaphore = new Semaphore(store.state.concurrency);
    const targetIds = new Set(targets.map((t) => t.id));

    const worker = async () => {
      while (true) {
        if (token !== cancelToken.run) return;
        await semaphore.acquire();
        let item: QueueItem | undefined;
        try {
          if (token !== cancelToken.run) return;
          // JS 单线程：acquire 到此处之间无 await，原子认领下一个待办项
          item = store.items.find(
            (i) =>
              targetIds.has(i.id) &&
              !claimed.has(i.id) &&
              i.status === "queued",
          );
          if (!item) return;
          claimed.add(item.id);
          item.error = null;
          item.attempts++;

          // 信号量内解码，严格限制同时解码数量
          let asset = item.asset;
          if (!asset) {
            item.status = "decoding";
            try {
              asset = await decodeImage(item.source.dataUrl, item.fileName);
              item.asset = asset;
            } catch (e) {
              item.status = "error";
              item.error =
                e instanceof Error ? e.message : "图片损坏，无法解码";
              continue; // 跳过损坏图片，其余项目照常；用户可点重试
            }
          }
          if (token !== cancelToken.run) {
            item.status = "canceled";
            return;
          }
          item.status = "rendering";
          // 让一帧，确保 decoding -> rendering 状态变化可被观察
          await new Promise((r) => setTimeout(r, 0));
          if (token !== cancelToken.run) {
            item.status = "canceled";
            return;
          }

          const settings: Settings = frozen
            ? JSON.parse(JSON.stringify(frozen))
            : JSON.parse(JSON.stringify(store.doc.settings));
          const ruleVersion = frozen ? frozenVersion : store.state.ruleVersion;
          try {
            const grid = generateFrom(asset, item.crop, settings);
            item.ruleVersion = ruleVersion;
            item.result = {
              grid,
              settings,
              crop: { ...item.crop },
              ruleVersion,
              batch,
              finishedAt: Date.now(),
              fileStem: buildFileStem(
                item.fileName,
                asset.width,
                asset.height,
                item.id,
              ),
            };
            item.status = "done";
            item.stale = false;
            item.error = null;
            if (store.state.selectedId === item.id) {
              store.doc.asset = asset;
            }
          } catch (e) {
            item.status = "error";
            item.error = e instanceof Error ? e.message : "生成失败";
          }
        } finally {
          semaphore.release();
        }
      }
    };

    await Promise.all(
      Array.from({ length: store.state.concurrency }, () => worker()),
    );

    if (token === cancelToken.run) {
      store.state.running = false;
      const s = stats.value;
      store.notice(
        `批次 #${batch} 完成：${s.done} 张成品，${s.failed} 张失败，${s.canceled} 张已取消`,
      );
    }
  }

  function start() {
    if (store.state.running) return;
    // 没有排队项但存在失败/取消项时，重新开始这些可重试项
    const queued = store.items.filter((i) => i.status === "queued");
    if (!queued.length) {
      const retryable = store.items.filter(
        (i) => i.status === "error" || i.status === "canceled",
      );
      if (!retryable.length) {
        store.notice("队列为空，请先添加图片");
        return;
      }
      for (const item of retryable) {
        item.status = "queued";
        item.error = null;
      }
    }
    void run(null);
  }

  function cancel() {
    if (!store.state.running) return;
    cancelToken.run++;
    store.state.running = false;
    for (const item of store.items) {
      if (item.status === "queued" || item.status === "decoding" || item.status === "rendering") {
        item.status = "canceled";
        item.error = null;
      }
      // done / error 的项目原样保留，成品仍可单独取出
    }
    store.notice("已取消：完成的成品保留在队列中，可单独下载");
  }

  function reapply(scope: "pending" | "completed") {
    if (store.state.running) return;
    if (!store.items.length) {
      store.notice("队列为空");
      return;
    }
    // 一次性把当前公共规则固化给本批所有目标，杜绝同一批次新旧参数混用
    const snapshot: Settings = JSON.parse(
      JSON.stringify(store.doc.settings),
    );
    const version = store.state.ruleVersion;
    const targets: QueueItem[] = [];
    for (const item of store.items) {
      const match =
        scope === "pending"
          ? item.status === "queued" ||
            item.status === "error" ||
            item.status === "canceled"
          : item.status === "done";
      if (!match) continue;
      item.status = "queued";
      item.error = null;
      item.stale = false;
      item.ruleVersion = version;
      targets.push(item);
    }
    if (!targets.length) {
      store.notice(scope === "pending" ? "没有未开始的项目" : "没有已完成项目");
      return;
    }
    void run(targets, {
      silent: true,
      snapshot,
      snapshotVersion: version,
    }).finally(() => {
      // run 内部已自增批次号，这里读取实际生效的批次
      const batch = store.state.batch;
      store.notice(
        scope === "pending"
          ? `批次 #${batch}：当前规则只应用到 ${targets.length} 个未开始项目`
          : `批次 #${batch}：${targets.length} 个已完成项目已按当前规则重新生成`,
      );
    });
  }

  function itemPng(item: QueueItem): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      drawGrid(canvas, item.result!.grid, item.result!.settings.color, item.result!.settings.background);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 失败"))), "image/png");
    });
  }

  async function downloadItem(id: string, kind: "txt" | "png") {
    const item = store.items.find((i) => i.id === id);
    if (!item?.result) return;
    const name = withExt(item.result.fileStem, kind);
    if (kind === "txt") {
      download(
        new Blob([textContent(item.result.grid)], {
          type: "text/plain;charset=utf-8",
        }),
        name,
      );
    } else {
      download(await itemPng(item), name);
    }
    store.notice(`已下载 ${name}（规则 v${item.result.ruleVersion} · 批次 #${item.result.batch}）`);
  }

  async function downloadAll() {
    const done = store.items.filter((i) => i.result && i.status === "done");
    if (!done.length || store.state.exporting) {
      if (!done.length) store.notice("还没有可下载的成品");
      return;
    }
    store.state.exporting = true;
    try {
      const bundleName = `ascii-bundle-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, "-")}`;
      const { blob, entries, skipped } = await buildBundleZip(
        store.items,
        bundleName,
      );
      download(blob, `${bundleName}.zip`);
      store.notice(
        `汇总包已生成：${entries.length} 套文本+图片+清单` +
          (skipped ? `，跳过 ${skipped} 个未完成项` : ""),
      );
    } catch (e) {
      store.notice(e instanceof Error ? e.message : "汇总下载失败");
    } finally {
      store.state.exporting = false;
    }
  }

  function statusLabel(status: QueueStatus): string {
    return (
      {
        queued: "等待中",
        decoding: "解码中",
        rendering: "生成中",
        done: "已完成",
        error: "失败",
        canceled: "已取消",
      } as Record<QueueStatus, string>
    )[status];
  }

  return {
    items: store.items,
    state: store.state,
    stats,
    selected,
    bumpRuleVersion,
    enqueueFiles,
    enqueueDataUrl,
    select,
    ensureDecoded,
    syncCropFromDoc,
    remove,
    clearFinished,
    resetCrop,
    retry,
    start,
    cancel,
    reapply,
    downloadItem,
    downloadAll,
    statusLabel,
    MAX_CONCURRENCY,
  };
}

export type QueueStoreApi = ReturnType<typeof createQueueStore>;
