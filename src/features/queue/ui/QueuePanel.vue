<script setup lang="ts">
import { computed } from "vue";
import {
  ListPlus,
  Play,
  CircleStop,
  Download,
  RefreshCw,
  Trash2,
  RotateCcw,
  FileWarning,
  Snowflake,
  Wand2,
} from "lucide-vue-next";
import { useStudio } from "../../../shared/useStudio";
import { MAX_CONCURRENCY } from "../model/queueStore";
import type { QueueItem } from "../model/types";

const { queue: q, queueState, notice } = useStudio();

const dropActive = computed({
  get: () => false,
  set: () => {},
});
let dragDepth = 0;
function dragenter() {
  dragDepth++;
  dropActive.value = true;
}
function dragleave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropActive.value = false;
}
async function pick(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) {
    const rejected = await q.enqueueFiles(Array.from(input.files));
    if (rejected.length)
      notice.value = rejected
        .map((r) => `${r.name}：${r.reason}`)
        .join("；");
  }
  input.value = "";
}
async function drop(e: DragEvent) {
  dragDepth = 0;
  dropActive.value = false;
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length) {
    const rejected = await q.enqueueFiles(files);
    if (rejected.length)
      notice.value = rejected.map((r) => `${r.name}：${r.reason}`).join("；");
  }
}

function itemClasses(item: QueueItem) {
  return [
    "queue-item",
    `is-${item.status}`,
    {
      selected: item.id === queueState.selectedId,
      stale: item.stale,
    },
  ];
}

function sizeLabel(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const progressPct = computed(() => {
  const s = q.stats.value;
  if (!s.total) return 0;
  return Math.round(((s.done + s.failed) / s.total) * 100);
});
</script>

<template>
  <section class="panel queue-panel">
    <div class="section-title">
      <span>04 / BATCH QUEUE</span><ListPlus :size="15" />
    </div>

    <label
      class="queue-drop"
      :class="{ active: dropActive }"
      @dragover.prevent
      @dragenter.prevent="dragenter"
      @dragleave="dragleave"
      @drop.prevent="drop"
    >
      <ListPlus :size="22" />
      <strong>批量添加图片</strong>
      <small>可多选或拖入多张 · PNG / JPG / WEBP · 单张 ≤ 20MB</small>
      <input
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        @change="pick"
      />
    </label>

    <div class="mode-switch" role="group" aria-label="公共规则应用方式">
      <button
        :class="{ active: queueState.mode === 'frozen' }"
        :disabled="queueState.running"
        @click="queueState.mode = 'frozen'"
      >
        <Snowflake :size="13" /> 冻结规则
      </button>
      <button
        :class="{ active: queueState.mode === 'follow' }"
        :disabled="queueState.running"
        @click="queueState.mode = 'follow'"
      >
        <Wand2 :size="13" /> 持续跟随
      </button>
    </div>
    <p class="mode-hint">
      {{
        queueState.mode === "frozen"
          ? "开始时固化整批规则：运行中修改密度不影响本批，已开始与未开始项目保持同一版本。"
          : "每项开工时读取当前规则：运行中修改密度，随后开工的项目立即使用新参数，每项仍独立快照、不混用。"
      }}
    </p>

    <label class="field concurrency-field">
      同时解码上限 <b>{{ queueState.concurrency }} 张</b>
      <input
        aria-label="同时解码数量"
        type="range"
        min="1"
        :max="MAX_CONCURRENCY"
        step="1"
        v-model.number="queueState.concurrency"
      />
    </label>

    <div class="queue-actions">
      <button
        v-if="!queueState.running"
        class="primary queue-start"
        :disabled="!q.stats.value.pending && !q.stats.value.failed && !q.stats.value.canceled"
        @click="q.start"
      >
        <Play :size="15" /> 开始队列
      </button>
      <button v-else class="secondary queue-cancel" @click="q.cancel">
        <CircleStop :size="15" /> 取消（保留成品）
      </button>
      <div class="reapply-group">
        <button
          class="secondary small"
          :disabled="queueState.running"
          title="把当前公共规则只应用到未开始 / 失败 / 已取消项目"
          @click="q.reapply('pending')"
        >
          <RefreshCw :size="13" /> 应用到未开始
        </button>
        <button
          class="secondary small"
          :disabled="queueState.running"
          title="用当前公共规则重新生成全部已完成项目"
          @click="q.reapply('completed')"
        >
          <RefreshCw :size="13" /> 重生成已完成
        </button>
      </div>
    </div>

    <div class="queue-progress" v-if="q.stats.value.total">
      <div class="bar"><i :style="{ width: progressPct + '%' }" /></div>
      <div class="progress-meta mono">
        <span>完成 {{ q.stats.value.done }} / {{ q.stats.value.total }}</span>
        <span v-if="q.stats.value.running">进行 {{ q.stats.value.running }}</span>
        <span v-if="q.stats.value.failed" class="warn">失败 {{ q.stats.value.failed }}</span>
        <span v-if="q.stats.value.canceled" class="muted">取消 {{ q.stats.value.canceled }}</span>
        <span>规则 v{{ queueState.ruleVersion }}</span>
      </div>
    </div>

    <ul class="queue-list" v-if="q.stats.value.total">
      <li
        v-for="item in q.items"
        :key="item.id"
        :class="itemClasses(item)"
        @click="q.select(item.id); q.ensureDecoded(item.id)"
      >
        <div class="item-head">
          <span class="item-name" :title="item.fileName">{{ item.fileName }}</span>
          <span class="item-status" :data-status="item.status">
            {{ q.statusLabel(item.status) }}
          </span>
        </div>
        <div class="item-meta mono">
          <span v-if="item.asset">{{ item.asset.width }}×{{ item.asset.height }}</span>
          <span v-else>{{ sizeLabel(item.fileSize) }}</span>
          <span v-if="item.attempts > 1">重试 {{ item.attempts - 1 }}</span>
          <span v-if="item.result">v{{ item.result.ruleVersion }} · #{{ item.result.batch }}</span>
          <span v-if="item.stale" class="warn">规则已更新</span>
        </div>
        <div class="item-error" v-if="item.error">
          <FileWarning :size="12" /> {{ item.error }}
        </div>
        <div class="item-buttons" @click.stop>
          <button
            v-if="item.status === 'error' || item.status === 'canceled'"
            class="mini"
            :disabled="queueState.running"
            @click="q.retry(item.id)"
          >
            <RotateCcw :size="12" /> 重试
          </button>
          <button
            v-if="item.result"
            class="mini"
            @click="q.downloadItem(item.id, 'txt')"
          >
            TXT
          </button>
          <button
            v-if="item.result"
            class="mini"
            @click="q.downloadItem(item.id, 'png')"
          >
            PNG
          </button>
          <button
            class="mini danger"
            :disabled="item.status === 'decoding' || item.status === 'rendering'"
            @click="q.remove(item.id)"
          >
            <Trash2 :size="12" />
          </button>
        </div>
      </li>
    </ul>
    <div class="queue-footer" v-if="q.stats.value.total">
      <button class="secondary small" @click="q.clearFinished">
        <Trash2 :size="12" /> 清理已结束项
      </button>
      <button
        class="primary small"
        :disabled="!q.stats.value.done || queueState.exporting"
        @click="q.downloadAll"
      >
        <Download :size="13" />
        {{ queueState.exporting ? "打包中…" : `汇总下载（${q.stats.value.done} 套）` }}
      </button>
    </div>
  </section>
</template>
