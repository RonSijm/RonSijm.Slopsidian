export const WEB_HISTORY_ORDERS = [
  ["newest", "Newest first"], ["oldest", "Oldest first"],
  ["title-asc", "Title A–Z"], ["title-desc", "Title Z–A"],
  ["address-asc", "Address A–Z"], ["address-desc", "Address Z–A"],
] as const;
export type WebHistoryOrder = typeof WEB_HISTORY_ORDERS[number][0];

export function historyOrder(value: unknown = "newest"): WebHistoryOrder {
  if (!WEB_HISTORY_ORDERS.some(([order]) => order === value)) { throw new Error("Choose a supported history sort order."); }
  return value as WebHistoryOrder;
}

export function historyOrderLabel(value: unknown = "newest"): string {
  const order = historyOrder(value);
  return WEB_HISTORY_ORDERS.find(([key]) => key === order)![1];
}
