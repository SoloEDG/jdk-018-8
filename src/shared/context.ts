import type { InjectionKey, Ref } from "vue";
import type { StudioDocument } from "./document";
import type { QueueStoreApi } from "../features/queue/model/queueStore";

export interface QueueState {
  mode: import("../features/queue/model/types").QueueMode;
  concurrency: number;
  running: boolean;
  exporting: boolean;
  selectedId: string | null;
  ruleVersion: number;
  batch: number;
}

export interface StudioContext {
  doc: StudioDocument;
  busy: Ref<boolean>;
  notice: Ref<string>;
  invalidate: () => void;
  queue: QueueStoreApi;
  queueState: QueueState;
}
export const studioKey: InjectionKey<StudioContext> = Symbol("studio");
