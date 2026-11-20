# 批量工作队列（Batch Queue）

在原有单图字符画流程之外，新增对一组图片批量应用转换规则的工作队列。所有处理仍在浏览器本地完成。

## 目录结构

```
src/features/queue/
├── model/
│   ├── types.ts        # 队列项 / 状态 / 成品（QueueResult）类型
│   ├── queueStore.ts   # 队列状态机：调度、取消、快照、重试、导出
│   └── useQueue.ts     # 组合式入口
├── lib/
│   ├── semaphore.ts    # 并发信号量（限制同时解码数量）
│   ├── naming.ts       # 防覆盖唯一文件名（基础名-宽x高-ID）
│   ├── zip.ts          # 零依赖 ZIP（STORE + CRC32，UTF-8 文件名）
│   └── bundle.ts       # 汇总包：text/ + image/ + manifest.json
└── ui/QueuePanel.vue   # 队列面板
```

## 需求与实现对照

| 需求 | 实现 |
| --- | --- |
| 把当前转换规则应用到各张图片，逐项预览 | 每个队列项独立处理；选中项在右侧预览，预览始终指向该项 `result.grid`（实际完成版本） |
| 每张图保留独立裁剪 | 裁剪保存在 `QueueItem.crop`，生成时随成品快照存入 `result.crop`，互不影响 |
| 调整公共规则时可选择只应用到未开始项或重生成已完成项 | `reapply('pending')` 与 `reapply('completed')`，均一次性固化同一快照，范围互斥 |
| 不能混用新参数与旧布局 | 每个成品绑定生成时的**完整 `Settings` 深快照**与裁剪；同批次共用同一份快照 |
| 限制同时解码数量 | `Semaphore`，解码在信号量内执行，上限可调（1–4） |
| 损坏图片可跳过并重试 | 解码/生成失败标记 `error` 并跳过，不影响其他项；可单项 `retry` 或整批重新开始 |
| 取消后已完成结果仍可单独取出 | `cancel` 只把进行中/排队项标记 `canceled`，`done` 项的 `result` 原样保留，可单独下载 TXT/PNG |
| 同名文件、不同宽高不能覆盖彼此 | 文件名 = `安全名-宽x高-8位ID`；打包时再做一次去重兜底 |
| 执行前决定冻结还是持续跟随 | 模式开关，运行中锁定不可切换 |
| 两种模式下改密度有明确可观察结果 | 见下节；通过单调递增 `ruleVersion` 与卡片“规则已更新”标记体现 |
| 汇总下载的文本、图片、清单指向实际完成版本 | `buildBundleZip` 仅收录 `status==='done' && result` 的项，清单记录每项的 settings/crop/ruleVersion/batch/文件名 |

## 冻结 vs 持续跟随

- **冻结规则（frozen）**：点击“开始队列”的瞬间深拷贝一份公共规则，整批所有项目共用。运行中再拖动密度滑块，本批成品保持启动时的参数，卡片规则版本不变。
- **持续跟随（follow）**：不做整批快照，每个项目在自己**开工那一刻**读取当前公共规则与 `ruleVersion`。运行中改密度，已经完成的项目不变，随后开工的项目立即采用新密度，并在卡片上显示各自的规则版本。

两种模式下，单个成品都携带独立完整的规则快照，因此不会出现“新参数 + 旧布局”的混搭。

## 汇总包内容

```
ascii-bundle-<时间戳>.zip
├── text/<安全名>-<宽>x<高>-<id>.txt
├── image/<安全名>-<宽>x<高>-<id>.png
└── manifest.json   # 每项来源、尺寸、字符网格、规则版本、批次、裁剪、完整 settings、对应文件路径
```

未完成（排队/失败/取消）的项目不会进入汇总包，清单只描述真正完成的版本。

## 测试

纯逻辑与状态机测试位于独立目录 `/workspace/queue-tests`（与应用源码隔离）：

```bash
node --test /workspace/queue-tests/queue.test.mjs \
            /workspace/queue-tests/queue-store.test.mjs
```

- `queue.test.mjs`：CRC32 已知向量、ZIP 可被 Python `zipfile`/unzip 读取且中文文件名正确、信号量并发上限、命名防覆盖。
- `queue-store.test.mjs`：用 mock DOM 驱动真实 `queueStore`，覆盖损坏跳过+重试、并发解码上限、取消保留成品、冻结/跟随语义、两种重应用范围、防覆盖、清单版本一致性。
