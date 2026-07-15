import { db } from '../database.js';

export function audit(event, req, fields = {}) {
  const metadata = fields.metadata ? JSON.stringify(fields.metadata) : null;
  db.prepare(`
    INSERT INTO api_audit_logs
      (event, user_id, token_id, resource_type, resource_id, request_id, ip, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event,
    fields.userId || req?.user?.id || req?.apiToken?.user_id || null,
    fields.tokenId || req?.apiToken?.id || null,
    fields.resourceType || null,
    fields.resourceId ? String(fields.resourceId) : null,
    req?.requestId || null,
    req?.ip || null,
    metadata,
    Date.now(),
  );
}
