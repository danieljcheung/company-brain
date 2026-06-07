type RateLimitStore = {
  count: number;
  resetTime: number;
};

const stores = new Map<string, Map<string, RateLimitStore>>();

export function getRateLimit(key: string, namespace: string, limit: number, windowMs: number) {
  let namespaceStore = stores.get(namespace);
  if (!namespaceStore) {
    namespaceStore = new Map<string, RateLimitStore>();
    stores.set(namespace, namespaceStore);
  }

  const now = Date.now();
  const record = namespaceStore.get(key);

  if (!record || now > record.resetTime) {
    return {
      isBlocked: false,
      remaining: limit,
      resetInSeconds: Math.ceil(windowMs / 1000),
      increment: () => {
        namespaceStore!.set(key, { count: 1, resetTime: now + windowMs });
      },
      reset: () => {
        namespaceStore!.delete(key);
      }
    };
  }

  const isBlocked = record.count >= limit;
  const resetInSeconds = Math.ceil((record.resetTime - now) / 1000);

  return {
    isBlocked,
    remaining: Math.max(0, limit - record.count),
    resetInSeconds,
    increment: () => {
      record.count += 1;
      namespaceStore!.set(key, record);
    },
    reset: () => {
      namespaceStore!.delete(key);
    }
  };
}
