export function normalizeSellerExportJobId(value = "") {
  return String(value || "").trim();
}

export function findNewSellerExportJob(baselineJobs = [], currentJobs = [], options = {}) {
  const baselineIds = new Set((baselineJobs || [])
    .map((job) => normalizeSellerExportJobId(typeof job === "object" ? job?.id : job))
    .filter(Boolean));
  const notBeforeMs = Number(options.notBeforeMs || 0);
  const allowedClockSkewMs = Math.max(0, Number(options.allowedClockSkewMs || 0));
  return (currentJobs || []).find((job) => {
    const jobId = normalizeSellerExportJobId(job?.id);
    const startAtMs = Number(job?.startAtMs || 0);
    const freshEnough = !notBeforeMs || (startAtMs > 0 && startAtMs >= notBeforeMs - allowedClockSkewMs);
    return jobId && !baselineIds.has(jobId) && freshEnough;
  }) || null;
}
