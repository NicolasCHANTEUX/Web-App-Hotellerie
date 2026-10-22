function timeZoneOffsetMinutes(at: Date, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/** The instant a calendar day begins in the property's time zone. */
export function startOfPropertyDay(date: string, timeZone: string) {
  const utcMidnight = new Date(`${date}T00:00:00.000Z`);
  return new Date(utcMidnight.getTime() - timeZoneOffsetMinutes(utcMidnight, timeZone) * 60_000);
}
