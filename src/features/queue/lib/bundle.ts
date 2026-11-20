import type { Grid, Settings } from "../../../shared/document";
import type { QueueItem } from "../model/types";
import { textContent } from "../../export/lib/text";
import { drawGrid } from "../../preview/lib/draw";
import { buildZip, type ZipEntry } from "./zip";
import { withExt } from "./naming";

export interface ManifestEntry {
  id: string;
  source: string;
  sourceWidth: number;
  sourceHeight: number;
  gridColumns: number;
  gridRows: number;
  characters: number;
  ruleVersion: number;
  batch: number;
  finishedAt: string;
  files: { txt: string; png: string };
  settings: Settings;
  crop: QueueItem["crop"];
}

function gridPng(grid: Grid, settings: Settings): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    drawGrid(canvas, grid, settings.color, settings.background);
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG 渲染失败"));
    }, "image/png");
  });
}

async function toUint8(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 汇总下载：仅包含真正完成（带 result）的项目，
 * 每一项都取其 result 内冻结的 grid / settings，绝不混入当前编辑中的规则。
 */
export async function buildBundleZip(
  items: QueueItem[],
  bundleName: string,
): Promise<{ blob: Blob; entries: ManifestEntry[]; skipped: number }> {
  const done = items.filter((i) => i.result && i.status === "done");
  const usedNames = new Set<string>();
  const entries: ZipEntry[] = [];
  const manifest: ManifestEntry[] = [];

  for (const item of done) {
    const result = item.result!;
    const txtName = withExt(result.fileStem, "txt");
    const pngName = withExt(result.fileStem, "png");
    // 额外保险：fileStem 已含 ID，这里再做一次去重，任何情况下都不覆盖
    const unique = (name: string) => {
      let candidate = name;
      let n = 1;
      while (usedNames.has(candidate)) {
        candidate = name.replace(/(\.[^.]+)$/, `-${n}$1`);
        n++;
      }
      usedNames.add(candidate);
      return candidate;
    };
    const txtPath = unique(`text/${txtName}`);
    const pngPath = unique(`image/${pngName}`);

    const txtBytes = new TextEncoder().encode(textContent(result.grid));
    const pngBytes = await toUint8(
      await gridPng(result.grid, result.settings),
    );
    entries.push({ path: txtPath, data: txtBytes });
    entries.push({ path: pngPath, data: pngBytes });

    manifest.push({
      id: item.id,
      source: item.fileName,
      sourceWidth: item.asset?.width ?? 0,
      sourceHeight: item.asset?.height ?? 0,
      gridColumns: result.grid.columns,
      gridRows: result.grid.rows,
      characters: result.grid.cells.length,
      ruleVersion: result.ruleVersion,
      batch: result.batch,
      finishedAt: new Date(result.finishedAt).toISOString(),
      files: { txt: txtPath, png: pngPath },
      settings: result.settings,
      crop: result.crop,
    });
  }

  const manifestJson = new TextEncoder().encode(
    JSON.stringify(
      {
        bundle: bundleName,
        exportedAt: new Date().toISOString(),
        count: manifest.length,
        items: manifest,
      },
      null,
      2,
    ),
  );
  entries.push({ path: "manifest.json", data: manifestJson });

  return {
    blob: buildZip(entries),
    entries: manifest,
    skipped: items.length - done.length,
  };
}
