import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const EMPTY = {
  version: 1,
  products: [],
  ledger: [],
  orders: [],
  favorites: [],
  settings: {},
  collector: { status: "idle", lastPage: 0, lastFingerprint: "", repeatedPages: 0 }
};

export class JsonStore {
  constructor(baseDir) {
    this.path = join(baseDir, "around-g-data.json");
    this.data = structuredClone(EMPTY);
    this.queue = Promise.resolve();
  }

  async load() {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      this.data = { ...structuredClone(EMPTY), ...parsed };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        const backup = `${this.path}.damaged-${Date.now()}`;
        await rename(this.path, backup);
      }
      await this.save();
    }
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.data);
  }

  save() {
    this.queue = this.queue.then(async () => {
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(this.data, null, 2), "utf8");
      await rename(temporary, this.path);
    });
    return this.queue;
  }

  list(collection) {
    return structuredClone(this.data[collection] || []);
  }

  async upsert(collection, item) {
    const rows = this.data[collection];
    if (!Array.isArray(rows)) throw new Error("UNKNOWN_COLLECTION");
    const now = new Date().toISOString();
    const id = item.id || crypto.randomUUID();
    const index = rows.findIndex((row) => row.id === id);
    const next = { ...(index >= 0 ? rows[index] : {}), ...item, id, updatedAt: now };
    if (index >= 0) rows[index] = next;
    else rows.unshift(next);
    await this.save();
    return structuredClone(next);
  }

  async remove(collection, id) {
    const rows = this.data[collection];
    if (!Array.isArray(rows)) throw new Error("UNKNOWN_COLLECTION");
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) rows.splice(index, 1);
    await this.save();
    return index >= 0;
  }

  async setSettings(settings) {
    this.data.settings = { ...this.data.settings, ...settings };
    await this.save();
  }

  async updateCollector(input) {
    const previous = this.data.collector;
    const samePage = input.page === previous.lastPage && input.fingerprint === previous.lastFingerprint;
    const repeatedPages = samePage ? previous.repeatedPages + 1 : 0;
    const hardStop = input.captcha || repeatedPages >= 2 || input.page >= 75;
    this.data.collector = {
      status: hardStop ? (input.captcha ? "captcha" : "export-required") : "ready",
      lastPage: Number(input.page || 0),
      lastFingerprint: String(input.fingerprint || ""),
      repeatedPages,
      reason: input.captcha
        ? "보안 퍼즐은 사용자가 완료한 뒤 상태를 다시 확인해야 합니다."
        : repeatedPages >= 2
          ? "같은 페이지가 반복되어 자동 수집을 중단했습니다."
          : input.page >= 75
            ? "75페이지 이후는 Excel 내보내기로 전환합니다."
            : ""
    };
    await this.save();
    return structuredClone(this.data.collector);
  }
}
