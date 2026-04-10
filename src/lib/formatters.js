const DEFAULT_LOCALE = "en-ET";
const DEFAULT_CURRENCY = "ETB";

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeDate(value) {
  if (value == null) return null;

  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }

  if (typeof value?.toMillis === "function") {
    const d = new Date(value.toMillis());
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value?.seconds === "number") {
    const ms = value.seconds * 1000 + toFiniteNumber(value.nanoseconds, 0) / 1e6;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatCurrency(
  value,
  {
    locale = DEFAULT_LOCALE,
    currency = DEFAULT_CURRENCY,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
  } = {}
) {
  const amount = toFiniteNumber(value, 0);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(amount);
}

export function formatPercent(
  value,
  {
    locale = DEFAULT_LOCALE,
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    fromRatio = true,
  } = {}
) {
  const n = toFiniteNumber(value, 0);
  const ratio = fromRatio ? n : n / 100;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(ratio);
}

export function formatDateTime(
  value,
  {
    locale = DEFAULT_LOCALE,
    dateStyle = "medium",
    timeStyle = "short",
  } = {}
) {
  const d = safeDate(value);
  if (!d) return "—";

  return new Intl.DateTimeFormat(locale, {
    dateStyle,
    timeStyle,
  }).format(d);
}

export function formatDate(
  value,
  {
    locale = DEFAULT_LOCALE,
    dateStyle = "medium",
  } = {}
) {
  const d = safeDate(value);
  if (!d) return "—";

  return new Intl.DateTimeFormat(locale, {
    dateStyle,
  }).format(d);
}

export function formatTime(
  value,
  {
    locale = DEFAULT_LOCALE,
    timeStyle = "short",
  } = {}
) {
  const d = safeDate(value);
  if (!d) return "—";

  return new Intl.DateTimeFormat(locale, {
    timeStyle,
  }).format(d);
}

export function getTimestampMs(value) {
  const d = safeDate(value);
  return d ? d.getTime() : 0;
}

export function formatNumber(
  value,
  {
    locale = DEFAULT_LOCALE,
    minimumFractionDigits = 0,
    maximumFractionDigits = 0,
  } = {}
) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(toFiniteNumber(value, 0));
}
