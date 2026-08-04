export function normalizeSellerExportJobId(value = "") {
  return String(value || "").trim();
}

export function findNewSellerExportJob(baselineJobs = [], currentJobs = []) {
  const baselineIds = new Set((baselineJobs || [])
    .map((job) => normalizeSellerExportJobId(typeof job === "object" ? job?.id : job))
    .filter(Boolean));
  return (currentJobs || []).find((job) => {
    const jobId = normalizeSellerExportJobId(job?.id);
    return jobId && !baselineIds.has(jobId);
  }) || null;
}
