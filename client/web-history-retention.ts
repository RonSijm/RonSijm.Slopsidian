export const WEB_HISTORY_RETENTION_DAYS = [0, 7, 30, 90] as const;
export type WebHistoryRetentionDays = typeof WEB_HISTORY_RETENTION_DAYS[number];

export function historyRetentionDays(value: unknown = 0): WebHistoryRetentionDays {
  if (value !== 0 && value !== 7 && value !== 30 && value !== 90) {
    throw new Error("History age retention must be no age limit, 7, 30 or 90 days.");
  }
  return value;
}
