// Expense categories with an emoji + accent colour, reused by the form, the
// list rows and the charts so a category always looks the same everywhere.

export type Category = { name: string; emoji: string; color: string };

export const CATEGORIES: Category[] = [
  { name: "Food & Drink", emoji: "🍔", color: "#ff8a5c" },
  { name: "Groceries", emoji: "🛒", color: "#38d9a9" },
  { name: "Rent", emoji: "🏠", color: "#8b7bff" },
  { name: "Utilities", emoji: "💡", color: "#ffd43b" },
  { name: "Transport", emoji: "🚕", color: "#4dabf7" },
  { name: "Travel", emoji: "✈️", color: "#22b8cf" },
  { name: "Entertainment", emoji: "🎬", color: "#ff6bd0" },
  { name: "Shopping", emoji: "🛍️", color: "#f783ac" },
  { name: "Health", emoji: "💊", color: "#69db7c" },
  { name: "Gifts", emoji: "🎁", color: "#e599f7" },
  { name: "Other", emoji: "📦", color: "#adb5bd" },
];

const byName = new Map(CATEGORIES.map((c) => [c.name, c]));
const FALLBACK: Category = { name: "Other", emoji: "📦", color: "#adb5bd" };

export function categoryMeta(name: string): Category {
  return byName.get(name) ?? { ...FALLBACK, name: name || "Other" };
}

// A small palette of group cover emojis offered when creating a group.
export const GROUP_EMOJIS = [
  "🏖️", "🍜", "🏔️", "🎉", "🏡", "🚗", "🎓", "⚽", "🎸", "🍻", "🛫", "💼",
];
