// Writes an audit record. Pass a transaction client (tx) to keep it atomic with the change.
export const audit = (db, { userId, action, entityType, entityId, previousValues, newValues, ip }) =>
  db.auditLog.create({
    data: { userId, action, entityType, entityId, previousValues, newValues, ipAddress: ip },
  });
