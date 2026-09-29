import { describe, expect, it, vi } from "vitest";

function serializableTransactionRunner() {
  const executions: string[] = [];
  let balance = 5;
  let version = 0;

  return {
    executions,
    get balance() { return balance; },
    transaction: async (name: string, work: (read: () => { quantity: number; version: number }, write: (quantity: number, expectedVersion: number) => void) => Promise<void>) => {
      const snapshot = { quantity: balance, version };
      let nextQuantity = snapshot.quantity;
      const write = (quantity: number, expectedVersion: number) => {
        if (version !== expectedVersion) throw new Error("SERIALIZATION_FAILURE");
        nextQuantity = quantity;
      };
      await work(() => snapshot, write);
      if (version !== snapshot.version) throw new Error("SERIALIZATION_FAILURE");
      balance = nextQuantity;
      version += 1;
      executions.push(name);
    },
  };
}

describe("purchase inventory concurrency", () => {
  it("does not lose inventory when concurrent receipts serialize", async () => {
    const db = serializableTransactionRunner();

    await db.transaction("purchase-a", async (read, write) => {
      const current = read();
      write(current.quantity + 10, current.version);
    });

    await db.transaction("purchase-b", async (read, write) => {
      const current = read();
      write(current.quantity + 7, current.version);
    });

    expect(db.balance).toBe(22);
    expect(db.executions).toEqual(["purchase-a", "purchase-b"]);
  });

  it("rejects a stale concurrent write instead of overwriting the newer balance", async () => {
    const db = serializableTransactionRunner();
    let staleWrite: (() => void) | undefined;

    const first = db.transaction("purchase-a", async (read, write) => {
      const current = read();
      write(current.quantity + 10, current.version);
    });
    await first;

    await expect(db.transaction("purchase-b-stale", async (read, write) => {
      const current = read();
      staleWrite = () => write(current.quantity + 7, current.version - 1);
      staleWrite();
    })).rejects.toThrow("SERIALIZATION_FAILURE");

    expect(db.balance).toBe(15);
    expect(db.executions).toEqual(["purchase-a"]);
  });

  it("keeps the failed transaction from creating downstream effects", async () => {
    const db = serializableTransactionRunner();
    const movementCreate = vi.fn();
    const auditCreate = vi.fn();

    await db.transaction("purchase-a", async (read, write) => {
      const current = read();
      write(current.quantity + 10, current.version);
      movementCreate("purchase-a");
      auditCreate("purchase-a");
    });

    await expect(db.transaction("purchase-b-stale", async (read, write) => {
      const current = read();
      write(current.quantity + 7, current.version - 1);
      movementCreate("purchase-b-stale");
      auditCreate("purchase-b-stale");
    })).rejects.toThrow("SERIALIZATION_FAILURE");

    expect(db.balance).toBe(15);
    expect(movementCreate).toHaveBeenCalledTimes(2);
    expect(auditCreate).toHaveBeenCalledTimes(2);
  });
});
