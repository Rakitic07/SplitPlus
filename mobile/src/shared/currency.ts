// Pure currency helpers shared across web + mobile. Each GROUP carries its own
// ISO-4217 code (defaults to INR), so formatting is always by a group's code —
// there is no global picker.

export type Currency = { code: string; symbol: string; label: string; locale: string };

export const CURRENCIES: Currency[] = [
  { code: "INR", symbol: "₹", label: "Indian Rupee", locale: "en-IN" },
  { code: "USD", symbol: "$", label: "US Dollar", locale: "en-US" },
  { code: "EUR", symbol: "€", label: "Euro", locale: "de-DE" },
  { code: "GBP", symbol: "£", label: "British Pound", locale: "en-GB" },
  { code: "JPY", symbol: "¥", label: "Japanese Yen", locale: "ja-JP" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar", locale: "en-AU" },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar", locale: "en-CA" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar", locale: "en-SG" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham", locale: "en-AE" },
  { code: "CHF", symbol: "CHF", label: "Swiss Franc", locale: "de-CH" },
  { code: "CNY", symbol: "¥", label: "Chinese Yuan", locale: "zh-CN" },
];

const DEFAULT = CURRENCIES[0];

export function currencyMeta(code?: string | null): Currency {
  return CURRENCIES.find((c) => c.code === code) ?? DEFAULT;
}

export function formatMoney(code: string | undefined | null, value: number): string {
  const cur = currencyMeta(code);
  try {
    return new Intl.NumberFormat(cur.locale, {
      style: "currency",
      currency: cur.code,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${cur.symbol}${value.toFixed(2)}`;
  }
}

// Signed amount with a leading + / − and no currency-code noise — used for
// "you are owed / you owe" chips.
export function formatSigned(code: string | undefined | null, value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatMoney(code, Math.abs(value))}`;
}
