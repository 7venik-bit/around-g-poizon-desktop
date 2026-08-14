import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const EMPTY = {
  version: 1,
  products: [],
  categorySearches: [],
  ledger: [],
  orders: [],
  favorites: [],
  settings: {},
  collector: { status: "idle", lastPage: 0, lastFingerprint: "", repeatedPages: 0 }
};
const BRAND_CATALOG_BACKUP_MINIMUM = 3300;

async function replaceWithRetry(source, destination) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code) || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

export class JsonStore {
  constructor(baseDir) {
    this.path = join(baseDir, "around-g-data.json");
    this.brandCatalogBackupPath = join(baseDir, "around-g-brand-catalog.json");
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
    const currentCatalog = this.data?.settings?.brandCatalog;
    if (!Array.isArray(currentCatalog) || currentCatalog.length < BRAND_CATALOG_BACKUP_MINIMUM) {
      try {
        const backupCatalog = JSON.parse(await readFile(this.brandCatalogBackupPath, "utf8"));
        if (Array.isArray(backupCatalog) && backupCatalog.length >= BRAND_CATALOG_BACKUP_MINIMUM) {
          this.data.settings = {
            ...(this.data.settings || {}),
            brandCatalog: backupCatalog,
            brandCatalogUpdatedAt: this.data.settings?.brandCatalogUpdatedAt || new Date().toISOString(),
          };
          await this.save();
        }
      } catch {
        // 이전 버전에는 별도 브랜드 복구 파일이 없을 수 있다.
      }
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
      await replaceWithRetry(temporary, this.path);
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

  async bulkUpsert(collection, items) {
    const rows = this.data[collection];
    if (!Array.isArray(rows)) throw new Error("UNKNOWN_COLLECTION");
    if (!Array.isArray(items) || items.length > 500) throw new Error("BULK_ITEMS_INVALID");
    const now = new Date().toISOString();
    const updated = [];
    for (const item of items) {
      const id = item.id || crypto.randomUUID();
      const index = rows.findIndex((row) => row.id === id || (
        item.articleNumber && row.articleNumber === item.articleNumber
      ));
      const next = { ...(index >= 0 ? rows[index] : {}), ...item, id: index >= 0 ? rows[index].id : id, updatedAt: now };
      if (index >= 0) rows[index] = next;
      else rows.unshift(next);
      updated.push(next);
    }
    await this.save();
    return structuredClone(updated);
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
    if (Array.isArray(settings?.brandCatalog)
      && settings.brandCatalog.length >= BRAND_CATALOG_BACKUP_MINIMUM) {
      const temporary = `${this.brandCatalogBackupPath}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(settings.brandCatalog), "utf8");
        await replaceWithRetry(temporary, this.brandCatalogBackupPath);
      } catch {
        // 주 데이터 저장 성공을 별도 복구 파일 오류로 되돌리지 않는다.
      }
    }
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
