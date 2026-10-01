export function isSerializationConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === "P2034";
}

export async function runWithSerializableRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 25;
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationConflict(error) || attempt >= maxRetries) throw error;
      const delayMs = baseDelayMs * 2 ** attempt;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
