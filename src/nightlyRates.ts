export type NightGroup = { count: number; price: number; season: string | null };

/** Consecutive nights sharing a price and a season, as on the invoice. */
export function groupNights(nights: ReadonlyArray<{ price: number; season: string | null }>) {
  const groups: NightGroup[] = [];
  for (const night of nights) {
    const last = groups.at(-1);
    if (last && last.price === night.price && last.season === night.season) last.count += 1;
    else groups.push({ count: 1, price: night.price, season: night.season });
  }
  return groups;
}

/** Worth detailing when the price changes during the stay or comes from a season. */
export function showsNightDetail(groups: NightGroup[]) {
  return groups.length > 1 || groups.some((group) => group.season);
}

export function nightGroupLabel(group: NightGroup, formatPrice: (value: number) => string) {
  return `${group.count} nuit${group.count > 1 ? "s" : ""} × ${formatPrice(group.price)}${group.season ? ` · ${group.season}` : ""}`;
}
