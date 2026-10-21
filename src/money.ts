const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, cents: boolean) {
  const key = `${currency}:${cents}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.NumberFormat("fr-FR", { style: "currency", currency, minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
    formatters.set(key, format);
  }
  return format;
}

/** A price as French visitors read it: "135 €" when round, "456,60 €" otherwise. */
export function formatPrice(amount: number, currency = "EUR") {
  return formatter(currency || "EUR", !Number.isInteger(Math.round(amount * 100) / 100)).format(amount);
}
