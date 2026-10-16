// In-memory localStorage mock for node test environment
class LocalStorageMock {
  private store: Record<string, string> = {};

  clear() {
    this.store = {};
  }

  getItem(key: string) {
    return this.store[key] || null;
  }

  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }

  removeItem(key: string) {
    delete this.store[key];
  }
}

// @ts-expect-error polyfill for node test
globalThis.localStorage = new LocalStorageMock();

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = () => 'blob:mock-audio-url';
}
if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = () => {};
}
