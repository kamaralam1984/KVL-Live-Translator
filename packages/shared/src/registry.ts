export interface ProviderRegistry<T extends { id: string }> {
  register(provider: T): void;
  unregister(id: string): void;
  get(id: string): T | undefined;
  list(): T[];
  setActive(id: string): void;
  getActive(): T | undefined;
}

export function createProviderRegistry<T extends { id: string }>(): ProviderRegistry<T> {
  const providers = new Map<string, T>();
  let activeId: string | undefined;

  return {
    register(provider) {
      providers.set(provider.id, provider);
    },
    unregister(id) {
      providers.delete(id);
      if (activeId === id) activeId = undefined;
    },
    get(id) {
      return providers.get(id);
    },
    list() {
      return Array.from(providers.values());
    },
    setActive(id) {
      if (!providers.has(id)) {
        throw new Error(`Cannot activate unknown provider "${id}"`);
      }
      activeId = id;
    },
    getActive() {
      return activeId ? providers.get(activeId) : undefined;
    },
  };
}
