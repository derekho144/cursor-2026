/** Channel-adaptive quote follow-up delays (days after first send). */
export const FOLLOW_UP_DAYS_BY_SOURCE: Record<string, number> = {
  Google: 2,
  HelloToby: 2,
  PRO360: 2,
  FreelanceHunter: 3,
  Repeat: 5,
  Referral: 4,
  Instagram: 3,
  Facebook: 3,
  Website: 3,
  "88DB": 3,
  Other: 3,
};

export function followUpDaysForSource(
  leadSource: string | null | undefined,
  defaultDays: number
): number {
  if (!leadSource) return defaultDays;
  return FOLLOW_UP_DAYS_BY_SOURCE[leadSource] ?? defaultDays;
}
