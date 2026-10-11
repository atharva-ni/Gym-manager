export const PAYMENT_METHODS = ["upi", "cash", "card", "bank", "online", "other"] as const;
/** What a member payment is for. Product sales go through Inventory & POS instead. */
export const PAYMENT_CATEGORIES = ["membership", "admission", "personal_training", "other"] as const;
export const EXPENSE_CATEGORIES = [
  "rent", "salary", "utilities", "equipment", "maintenance", "marketing", "supplies", "other",
] as const;
export const EQUIPMENT_STATUSES = ["working", "needs_service", "out_of_order", "retired"] as const;
export const EQUIPMENT_CATEGORIES = ["cardio", "strength", "free_weights", "machines", "accessories", "other"] as const;
export const PRODUCT_CATEGORIES = ["supplement", "beverage", "apparel", "accessory", "other"] as const;
export const LEAD_SOURCES = ["walk_in", "referral", "instagram", "facebook", "google", "website", "other"] as const;
export const LEAD_STATUSES = ["new", "contacted", "trial", "converted", "lost"] as const;
export const MEMBER_STATUSES = ["active", "frozen", "inactive"] as const;
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"];

const LABELS: Record<string, string> = { upi: "UPI", bank: "Bank transfer", personal_training: "Personal training" };

export const label = (v: string | null | undefined) =>
  v ? (LABELS[v] ?? v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())) : "-";

export const options = (values: readonly string[]) => values.map((v) => ({ value: v, label: label(v) }));
