import { reactive, ref, provide, watch } from "vue";
import { createDocument } from "../shared/defaults";
import { studioKey } from "../shared/context";
import { generate } from "../features/mapping";
import { createQueueStore } from "../features/queue/model/queueStore";
import type { QueueItem, QueueMode } from "../features/queue/model/types";

export function useWorkspace() {
  const doc = reactive(createDocument());
  const busy = ref(false),
    notice = ref("所有处理均在浏览器中完成");
  let timer: ReturnType<typeof setTimeout>;
  function invalidate() {
    doc.revision++;
    busy.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        doc.grid = generate(doc);
      } catch (e) {
        notice.value = e instanceof Error ? e.message : "生成失败";
      } finally {
        busy.value = false;
      }
    }, 60);
  }
  watch(() => doc.settings.background, invalidate);

  // ---- 批量工作队列：所有队列状态集中在一个 reactive 对象，store 直接读写 ----
  const queueState = reactive({
    mode: "frozen" as QueueMode,
    concurrency: 2,
    running: false,
    exporting: false,
    selectedId: null as string | null,
    ruleVersion: 1,
    batch: 0,
  });
  const items = reactive<QueueItem[]>([]);

  const queue = createQueueStore({
    items,
    state: queueState,
    notice: (msg: string) => {
      notice.value = msg;
    },
    doc,
  });

  // 公共规则（密度、字符集、对比度、伽马、反转、彩色）编辑后提升规则版本；
  // background 走单图预览的 invalidate，不影响队列快照
  watch(
    () => [
      doc.settings.columns,
      doc.settings.charset,
      doc.settings.custom,
      doc.settings.contrast,
      doc.settings.gamma,
      doc.settings.invert,
      doc.settings.color,
    ],
    () => queue.bumpRuleVersion(),
  );

  // 选中项裁剪变化回写队列项；完成后的旧成品保留并标记 stale，不覆盖结果
  watch(
    () => [doc.crop.x, doc.crop.y, doc.crop.width, doc.crop.height],
    () => queue.syncCropFromDoc(),
  );

  provide(studioKey, {
    doc,
    busy,
    notice,
    invalidate,
    queue,
    queueState,
  });
  return { doc, busy, notice, queue, queueState };
}
