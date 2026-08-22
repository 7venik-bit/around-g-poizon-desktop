export function normalizeSellerExportJobId(value = "") {
  return String(value || "").trim();
}

export function findNewSellerExportJob(baselineJobs = [], currentJobs = [], options = {}) {
  const baselineIds = new Set((baselineJobs || [])
    .map((job) => normalizeSellerExportJobId(typeof job === "object" ? job?.id : job))
    .filter(Boolean));
  const notBeforeMs = Number(options.notBeforeMs || 0);
  const allowedClockSkewMs = Math.max(0, Number(options.allowedClockSkewMs || 0));
  const baselineAuthoritative = Boolean(options.baselineAuthoritative) && baselineIds.size > 0;
  return (currentJobs || []).find((job) => {
    const jobId = normalizeSellerExportJobId(job?.id);
    const startAtMs = Number(job?.startAtMs || 0);
    // A job absent from a real pre-export snapshot is reliable new-job
    // evidence even when POIZON renders a failed row without a usable time.
    // Timestamp stays mandatory only for the no-baseline recovery path.
    const freshEnough = baselineAuthoritative
      || !notBeforeMs
      || (startAtMs > 0 && startAtMs >= notBeforeMs - allowedClockSkewMs);
    return jobId && !baselineIds.has(jobId) && freshEnough;
  }) || null;
}
