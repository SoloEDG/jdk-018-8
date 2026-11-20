/** 限制同时进行的解码数量：超出的任务在 acquire 处排队等待 */
export class Semaphore {
  readonly limit: number;
  private free: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.limit = Math.max(1, limit);
    this.free = this.limit;
  }

  async acquire(): Promise<void> {
    if (this.free > 0) {
      this.free--;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    // 拿到许可时已由 release 侧完成 free--
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.free++;
    }
  }
}
