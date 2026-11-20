import { inject } from "vue";
import { studioKey } from "../../../shared/context";

export function useQueue() {
  const ctx = inject(studioKey);
  if (!ctx) throw new Error("Missing studio");
  if (!ctx.queue) throw new Error("Queue feature unavailable");
  return ctx.queue;
}
