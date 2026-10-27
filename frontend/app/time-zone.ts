const ZONES: Record<string, string | undefined> = {
  "This device": undefined,
  UTC: "UTC",
  "New York": "America/New_York",
  London: "Europe/London",
  Johannesburg: "Africa/Johannesburg",
  Dubai: "Asia/Dubai",
  Tokyo: "Asia/Tokyo",
  Sydney: "Australia/Sydney",
};

export const TIME_ZONE_NAMES = Object.keys(ZONES);

let active: string | undefined;

/** Called whenever the user's time-zone preference loads or changes. Unknown names fall back to the device zone. */
export const setActiveTimeZone = (name: string | null | undefined) => {
  active = name ? ZONES[name] : undefined;
};

export const formatDateTime = (value: string | number | Date, options?: Intl.DateTimeFormatOptions) =>
  new Date(value).toLocaleString(undefined, { timeZone: active, ...options });

export const formatClock = (value: Date) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: active, timeZoneName: "short" }).format(value);

export const formatDeskDate = (value: Date) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "2-digit", timeZone: active }).format(value).toUpperCase();
