import { describe, expect, it, vi } from "vitest";
import { isSerializationConflict, runWithSerializableRetry } from "../src/core/serializable-transaction";

describe("serializable transaction retry", () => {
  it("recognizes Prisma serialization conflicts", () => {
    expect(isSerializationConflict({ code: "P2034" })).toBe(true);
    expect(isSerializationConflict({ code: "P2002" })).toBe(false);
    expect(isSerializationConflict(new Error("SERIALIZATION_FAILURE"))).toBe(false);
  });

  it("retries a serialization conflict and returns the successful result", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" })
      .mockResolvedValue("committed");

    await expect(runWithSerializableRetry(operation, { maxRetries: 3, baseDelayMs: 0 }))
      .resolves.toBe("committed");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-serialization errors", async () => {
    const error = new Error("VALIDATION_FAILURE");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(runWithSerializableRetry(operation, { maxRetries: 3, baseDelayMs: 0 }))
      .rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured retry limit", async () => {
    const error = { code: "P2034" };
    const operation = vi.fn().mockRejectedValue(error);

    await expect(runWithSerializableRetry(operation, { maxRetries: 2, baseDelayMs: 0 }))
      .rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
