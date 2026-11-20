<script setup lang="ts">
import { onMounted } from "vue";
import { ImagePlus, Mountain, ListPlus } from "lucide-vue-next";
import { useSource } from "../model/useSource";
import { useStudio } from "../../../shared/useStudio";
const s = useSource();
const { queue, notice } = useStudio();
onMounted(() => s.demo());
function change(e: Event) {
  s.file((e.target as HTMLInputElement).files?.[0]);
  (e.target as HTMLInputElement).value = "";
}
async function queuePick(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) {
    const rejected = await queue.enqueueFiles(Array.from(input.files));
    if (rejected.length)
      notice.value = rejected.map((r) => `${r.name}：${r.reason}`).join("；");
  }
  input.value = "";
}
</script>
<template>
  <section class="panel">
    <div class="section-title">
      <span>01 / SOURCE</span><ImagePlus :size="15" />
    </div>
    <label
      class="upload"
      @dragover.prevent
      @drop.prevent="s.file($event.dataTransfer?.files[0])"
      ><ImagePlus :size="25" /><strong>{{
        s.loading.value ? "读取中…" : "拖入你的图片"
      }}</strong
      ><small>或点击选择文件 · 单图编辑模式</small
      ><input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        @change="change" /></label
    >
    <label class="upload queue-upload">
      <ListPlus :size="22" /><strong>加入批量队列</strong
      ><small>可一次选择多张图片</small
      ><input
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        @change="queuePick"
    /></label>
    <button class="demo" @click="s.demo">
      <Mountain :size="14" /> 使用山脉示例 <span>↗</span>
    </button>
    <div v-if="s.doc.asset" class="file-info">
      <span>{{ s.doc.asset.name }}</span
      ><small>{{ s.doc.asset.width }} × {{ s.doc.asset.height }} px</small>
    </div>
  </section>
</template>
