/**
 * IndexedDB 기반 커스텀 안내 음원 저장소
 * 대용량 오디오 Blob을 브라우저 로컬 DB에 영구 보관합니다.
 */

export interface CustomAudioItem {
  id: string;
  name: string;
  blob: Blob;
  type: string;
  size: number;
  duration?: number;
  updatedAt: number;
}

const DB_NAME = 'studycalm_db';
const DB_VERSION = 1;
const STORE_NAME = 'custom_audio';
const RECORD_ID = 'active_alert_audio';

export class CustomAudioRepo {
  private static openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB is not supported in this environment.'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 커스텀 오디오 파일 저장
   */
  public static async saveAudio(blob: Blob, name: string): Promise<CustomAudioItem> {
    const db = await this.openDB();
    const item: CustomAudioItem = {
      id: RECORD_ID,
      name,
      blob,
      type: blob.type || 'audio/mpeg',
      size: blob.size,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);

      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * 저장된 커스텀 오디오 조회
   */
  public static async getAudio(): Promise<CustomAudioItem | null> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      return null;
    }

    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(RECORD_ID);

        req.onsuccess = () => {
          resolve((req.result as CustomAudioItem) || null);
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  /**
   * 커스텀 오디오 삭제 (기본 음원으로 복원)
   */
  public static async deleteAudio(): Promise<void> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      return;
    }

    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(RECORD_ID);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // ignore
    }
  }

  // ------------------------------------------------------------------ 정시 안내용 녹음 (규칙 id별)

  private static clipKey(ruleId: string): string {
    return `announce_${ruleId}`;
  }

  /** 정시 안내 규칙에 연결된 녹음 저장 */
  public static async saveAnnounceClip(ruleId: string, blob: Blob): Promise<void> {
    const db = await this.openDB();
    const item: CustomAudioItem = {
      id: this.clipKey(ruleId),
      name: `안내 녹음 ${ruleId}`,
      blob,
      type: blob.type || 'audio/mp4',
      size: blob.size,
      updatedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public static async getAnnounceClip(ruleId: string): Promise<Blob | null> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return null;
    try {
      const db = await this.openDB();
      return await new Promise<Blob | null>((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(this.clipKey(ruleId));
        req.onsuccess = () => resolve((req.result as CustomAudioItem | undefined)?.blob ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  /** 녹음이 저장된 규칙 id 목록 */
  public static async listAnnounceClipIds(): Promise<string[]> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return [];
    try {
      const db = await this.openDB();
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return keys
        .map(String)
        .filter((k) => k.startsWith('announce_'))
        .map((k) => k.slice('announce_'.length));
    } catch {
      return [];
    }
  }

  /** 스케줄에서 사라진 규칙의 녹음 정리 */
  public static async pruneAnnounceClips(keepRuleIds: string[]): Promise<void> {
    const keep = new Set(keepRuleIds);
    const stale = (await this.listAnnounceClipIds()).filter((id) => !keep.has(id));
    if (stale.length === 0) return;
    const db = await this.openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const id of stale) store.delete(this.clipKey(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
