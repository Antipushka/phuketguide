export type FreshnessRequirement = "realtime" | "current" | "stable";
export type FreshnessConfidence = "high" | "medium" | "low";
export type SourceAuthority = "official" | "official_profile" | "authority" | "business_listing" | "aggregator" | "editorial" | "blog" | "historical";

export interface FreshnessEvidence {
  authority: SourceAuthority;
  datedCurrent?: boolean;
  historical?: boolean;
}

export interface FreshnessAssessment {
  requirement: FreshnessRequirement;
  confidence: FreshnessConfidence;
  canAnswer: boolean;
  qualificationNeeded: boolean;
}

/**
 * Combines the claim's sensitivity with authority and recency. An absent page date
 * is deliberately neutral: it is never treated as proof that a source is stale.
 */
export function assessFreshness(requirement: FreshnessRequirement, evidence: FreshnessEvidence[], conflicting = false): FreshnessAssessment {
  const usable = evidence.filter((source) => !source.historical && source.authority !== "historical");
  const official = usable.some((source) => ["official", "official_profile", "authority"].includes(source.authority));
  const current = usable.some((source) => source.datedCurrent);
  const corroborated = usable.length > 1;

  let confidence: FreshnessConfidence = current || (official && corroborated) ? "high" : official || usable.length ? "medium" : "low";
  if (conflicting) confidence = "low";
  const canAnswer = requirement !== "realtime" || (!conflicting && usable.length > 0);
  return { requirement, confidence, canAnswer, qualificationNeeded: confidence === "low" || (requirement === "realtime" && !current) };
}

export function isHistoricalReference(url: string, title: string | undefined, currentYear: number): boolean {
  const decoded = decodeURIComponent(`${url} ${title ?? ""}`).toLowerCase();
  if (/(?:archive|histor(?:y|ical)|climate|monthly|past-weather|weather-average|average-weather)/.test(decoded)) return true;
  const years = decoded.match(/(?:19|20)\d{2}/g)?.map(Number) ?? [];
  return years.some((year) => year < currentYear);
}
