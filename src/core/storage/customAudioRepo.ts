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
}
