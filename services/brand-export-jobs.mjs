export function normalizeSellerExportJobId(value = "") {
  return String(value || "").trim();
}

export function findNewSellerExportJob(baselineJobs = [], currentJobs = [], options = {}) {
  const baselineIds = new Set((baselineJobs || [])
    .map((job) => normalizeSellerExportJobId(typeof job === "object" ? job?.id : job))
    .filter(Boolean));
  const notBeforeMs = Number(options.notBeforeMs || 0);
  const allowedClockSkewMs = Math.max(0, Number(options.allowedClockSkewMs || 0));
  // An explicitly captured empty Download Center is still an authoritative
  // baseline. Requiring at least one previous id made the very first export
  // depend on POIZON's timestamp text, so a harmless date-format change could
  // leave the brand in EXPORT_JOB_NOT_CREATED forever.
  const baselineAuthoritative = Boolean(options.baselineAuthoritative);
  const allowMissingTimestamp = Boolean(options.allowMissingTimestamp);
  return (currentJobs || []).find((job) => {
    const jobId = normalizeSellerExportJobId(job?.id);
    const startAtMs = Number(job?.startAtMs || 0);
    // A job absent from a real pre-export snapshot is reliable new-job
    // evidence even when POIZON renders a failed row without a usable time.
    // Timestamp stays mandatory only for the no-baseline recovery path.
    const freshEnough = baselineAuthoritative
      || !notBeforeMs
      || (startAtMs > 0 && startAtMs >= notBeforeMs - allowedClockSkewMs)
      || (allowMissingTimestamp && startAtMs === 0);
    return jobId && !baselineIds.has(jobId) && freshEnough;
  }) || null;
}


export function findRecentSellerExportJob(currentJobs = [], options = {}) {
  const notBeforeMs = Number(options.notBeforeMs || 0);
  const allowedClockSkewMs = Math.max(0, Number(options.allowedClockSkewMs || 0));
  if (!notBeforeMs) return null;
  return [...(currentJobs || [])]
    .filter((job) => {
      const jobId = normalizeSellerExportJobId(job?.id);
      const startAtMs = Number(job?.startAtMs || 0);
      return jobId && startAtMs > 0 && startAtMs >= notBeforeMs - allowedClockSkewMs;
    })
    .sort((left, right) => Number(right?.startAtMs || 0) - Number(left?.startAtMs || 0))[0] || null;
}
