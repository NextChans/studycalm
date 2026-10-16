import { STORAGE_KEYS } from './storageKeys';

export class RoomRepo {
  public static getOrCreateRoomId(): string {
    if (typeof localStorage === 'undefined') {
      return 'sc-default';
    }

    let roomId = localStorage.getItem(STORAGE_KEYS.REMOTE_ROOM_ID);
    if (!roomId) {
      // 8자리 랜덤 룸 코드 생성 (예: sc-a8f3b2)
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      roomId = `sc-${randomSuffix}`;
      localStorage.setItem(STORAGE_KEYS.REMOTE_ROOM_ID, roomId);
    }
    return roomId;
  }

  public static setRoomId(newRoomId: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.REMOTE_ROOM_ID, newRoomId);
    }
  }

  public static regenerateRoomId(): string {
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const newRoomId = `sc-${randomSuffix}`;
    this.setRoomId(newRoomId);
    return newRoomId;
  }
}
