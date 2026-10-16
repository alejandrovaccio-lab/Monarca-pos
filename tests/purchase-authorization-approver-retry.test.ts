  it("rejects a retry when the requester reference changes", async () => {
    const transaction = tx();
    db.authorizationRequest.findUnique.mockResolvedValue(authorization());
    const changed = authorization();
    changed.requestedById = "requester-2";
    transaction.purchase.create.mockRejectedValueOnce(serializationConflict);
    transaction.authorizationRequest.findUnique
      .mockResolvedValueOnce(authorization())
      .mockResolvedValueOnce(changed);
    db.$transaction
      .mockImplementationOnce(async (callback: (value: any) => unknown) => callback(transaction))
      .mockImplementationOnce(async (callback: (value: any) => unknown) => callback(transaction));

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "manager-1" })).rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.authorizationRequest.findUnique).toHaveBeenCalledTimes(2);
    expect(transaction.purchase.create).toHaveBeenCalledTimes(1);
    expect(transaction.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(transaction.inventoryMovement.create).not.toHaveBeenCalled();
    expect(transaction.productCost.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a retry when the authorization resolution timestamp changes", async () => {
    const transaction = tx();
    db.authorizationRequest.findUnique.mockResolvedValue(authorization());
    const changed = authorization();
    changed.resolvedAt = new Date("2026-09-29T10:06:00.000Z");
    transaction.purchase.create.mockRejectedValueOnce(serializationConflict);
    transaction.authorizationRequest.findUnique
      .mockResolvedValueOnce(authorization())
      .mockResolvedValueOnce(changed);
    db.$transaction
      .mockImplementationOnce(async (callback: (value: any) => unknown) => callback(transaction))
      .mockImplementationOnce(async (callback: (value: any) => unknown) => callback(transaction));

    await expect(executeApprovedPurchaseReceipt({ requestId: "auth-1", executorId: "manager-1" })).rejects.toThrow("AUTHORIZATION_INTEGRITY_VIOLATION");
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(transaction.authorizationRequest.findUnique).toHaveBeenCalledTimes(2);
    expect(transaction.purchase.create).toHaveBeenCalledTimes(1);
    expect(transaction.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(transaction.inventoryMovement.create).not.toHaveBeenCalled();
    expect(transaction.productCost.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });