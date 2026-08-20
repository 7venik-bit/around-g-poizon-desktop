export const OFFICIAL_MALL_AUDIT_START_HOUR = 1;
export const OFFICIAL_MALL_AUDIT_END_HOUR = 6;

export function isOfficialMallAuditWindow(now = new Date()) {
  const hour = now.getHours();
  return hour >= OFFICIAL_MALL_AUDIT_START_HOUR && hour < OFFICIAL_MALL_AUDIT_END_HOUR;
}

export function nextOfficialMallAuditStartAt(now = new Date()) {
  if (isOfficialMallAuditWindow(now)) return new Date(now);
  const next = new Date(now);
  next.setHours(OFFICIAL_MALL_AUDIT_START_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export function currentOfficialMallAuditEndAt(now = new Date()) {
  const end = new Date(now);
  end.setHours(OFFICIAL_MALL_AUDIT_END_HOUR, 0, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return end;
}
