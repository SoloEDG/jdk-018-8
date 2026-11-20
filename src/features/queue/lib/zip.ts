/**
 * 零依赖 ZIP（仅 STORE 不压缩，兼容系统自带解压与 Python zipfile）。
 * 文件名按 UTF-8 写入并设置语言标志位，中文文件名不会乱码。
 */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

const encoder = new TextEncoder();

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}
function dosTime(date: Date): { time: number; date: number } {
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2),
    date:
      ((date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  };
}

export function buildZip(entries: ZipEntry[]): Blob {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = dosTime(new Date());

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const local = [
      ...u32(0x04034b50), // 本地文件头签名
      ...u16(20), // 解压版本
      ...u16(0x0800), // 标志位 11：UTF-8 文件名
      ...u16(0), // STORE
      ...u16(now.time),
      ...u16(now.date),
      ...u32(crc),
      ...u32(entry.data.length),
      ...u32(entry.data.length),
      ...u16(nameBytes.length),
      ...u16(0),
    ];
    const localHeader = Uint8Array.from(local);
    chunks.push(localHeader, nameBytes, entry.data);

    const centralHeader = Uint8Array.from([
      ...u32(0x02014b50), // 中央目录签名
      ...u16(20), // 制作版本
      ...u16(20), // 解压版本
      ...u16(0x0800),
      ...u16(0),
      ...u16(now.time),
      ...u16(now.date),
      ...u32(crc),
      ...u32(entry.data.length),
      ...u32(entry.data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
    ]);
    central.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + entry.data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) {
    chunks.push(c);
    centralSize += c.length;
  }

  const end = Uint8Array.from([
    ...u32(0x06054b50), // EOCD 签名
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(centralStart),
    ...u16(0),
  ]);
  chunks.push(end);
  return new Blob(chunks, { type: "application/zip" });
}
