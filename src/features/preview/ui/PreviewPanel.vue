<script setup lang="ts">
import { computed } from "vue";
import { Code2, Scan, Minus, Plus } from "lucide-vue-next";
import { useStudio } from "../../../shared/useStudio";
import { usePreview } from "../model/usePreview";
import { gridRows } from "../lib/rows";
import ArtCanvas from "./ArtCanvas.vue";

const p = usePreview();
const { queue } = useStudio();

// 队列选中项有成品时，预览永远指向该成品绑定的 grid/settings（实际完成版本）
const resultItem = computed(() => queue.selected.value);
const shownGrid = computed(
  () => resultItem.value?.result?.grid ?? p.doc.grid,
);
const shownColor = computed(
  () => resultItem.value?.result?.settings.color ?? p.doc.settings.color,
);
const shownBackground = computed(
  () =>
    resultItem.value?.result?.settings.background ??
    p.doc.settings.background,
);
const text = computed(() =>
  shownGrid.value ? gridRows(shownGrid.value).join("\n") : "",
);
const syncState = computed(() => {
  const item = resultItem.value;
  if (!item) {
    return p.busy.value
      ? "生成中"
      : p.doc.grid?.revision === p.doc.revision
        ? "已同步"
        : "待重新生成";
  }
  if (item.status === "done")
    return item.stale ? "成品为旧规则 · 可重新生成" : "已完成版本";
  return queue.statusLabel(item.status);
});
</script>
<template>
  <main class="workspace">
    <div class="preview-toolbar">
      <div class="tabs">
        <button
          :class="{ active: p.mode.value === 'art' }"
          @click="p.mode.value = 'art'"
        >
          <Scan :size="14" /> 字符预览</button
        ><button
          :class="{ active: p.mode.value === 'text' }"
          @click="p.mode.value = 'text'"
        >
          <Code2 :size="14" /> 纯文本
        </button>
      </div>
      <label class="color-toggle">
        <span class="color-dot" /> 彩色<input
          aria-label="彩色预览"
          type="checkbox"
          v-model="p.doc.settings.color"
      /></label>
    </div>
    <div class="art-stage">
      <div class="stage-label">OUTPUT / LIVE RENDER <span>●</span></div>
      <div class="art-scroll">
        <ArtCanvas
          v-if="shownGrid && p.mode.value === 'art'"
          :grid="shownGrid"
          :color="shownColor"
          :background="shownBackground"
          :zoom="p.zoom.value"
        />
        <pre
          v-else-if="shownGrid"
          data-testid="text-preview"
          :style="{
            fontSize: (14 * p.zoom.value) / 100 + 'px',
            lineHeight: (16 * p.zoom.value) / 100 + 'px',
          }"
          >{{ text }}</pre
        >
        <span v-else>正在准备字符画…</span>
      </div>
      <div class="stage-corner">
        {{ shownGrid?.columns }} COL × {{ shownGrid?.rows }} ROW
      </div>
    </div>
    <div class="preview-bottom">
      <span class="mono"
        ><i class="status-dot" />{{ syncState }}
        <template v-if="resultItem?.result">
          <span class="muted"
            >/ 规则 v{{ resultItem.result.ruleVersion }} · 批次
            #{{ resultItem.result.batch }}</span
          >
        </template>
        <span class="muted"> / {{ shownGrid?.cells.length.toLocaleString() ?? "0" }} 个字符</span>
      </span>
      <div class="zoom">
        <button
          aria-label="缩小"
          @click="p.zoom.value = Math.max(25, p.zoom.value - 25)"
        >
          <Minus :size="14" /></button
        ><span>{{ p.zoom.value }}%</span
        ><button
          aria-label="放大"
          @click="p.zoom.value = Math.min(200, p.zoom.value + 25)"
        >
          <Plus :size="14" />
        </button>
      </div>
    </div>
    <div class="workspace-note">
      <span>从像素，到字符。</span
      ><small>队列中的预览始终对应各项实际完成并冻结的规则版本。</small
      ><span class="note-symbol">{ Aa }</span>
    </div>
  </main>
</template>
