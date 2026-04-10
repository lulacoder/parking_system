import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from "date-fns";

export const TIME_RANGE_PRESET = {
  LAST_7_DAYS: "last_7_days",
  LAST_30_DAYS: "last_30_days",
  MONTH_TO_DATE: "month_to_date",
  QUARTER_TO_DATE: "quarter_to_date",
  YEAR_TO_DATE: "year_to_date",
  LAST_12_MONTHS: "last_12_months",
  THIS_WEEK: "this_week",
  CUSTOM: "custom",
};

const RANGE_LABELS = {
  [TIME_RANGE_PRESET.LAST_7_DAYS]: "Last 7 days",
  [TIME_RANGE_PRESET.LAST_30_DAYS]: "Last 30 days",
  [TIME_RANGE_PRESET.MONTH_TO_DATE]: "Month to date",
  [TIME_RANGE_PRESET.QUARTER_TO_DATE]: "Quarter to date",
  [TIME_RANGE_PRESET.YEAR_TO_DATE]: "Year to date",
  [TIME_RANGE_PRESET.LAST_12_MONTHS]: "Last 12 months",
  [TIME_RANGE_PRESET.THIS_WEEK]: "This week",
  [TIME_RANGE_PRESET.CUSTOM]: "Custom",
};

function quarterStart(date) {
  const month = date.getMonth();
  const quarterFirstMonth = Math.floor(month / 3) * 3;
  return startOfMonth(new Date(date.getFullYear(), quarterFirstMonth, 1));
}

function normalizeDate(value, fallback) {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function buildRange(fromDate, toDate, preset) {
  const from = startOfDay(fromDate);
  const to = endOfDay(toDate);
  return {
    preset,
    from,
    to,
    fromMs: from.getTime(),
    toMs: to.getTime(),
    label: RANGE_LABELS[preset] || "Custom",
  };
}

export function getPresetRange(preset, now = new Date()) {
  const anchor = normalizeDate(now, new Date());

  switch (preset) {
    case TIME_RANGE_PRESET.LAST_7_DAYS:
      return buildRange(subDays(anchor, 6), anchor, preset);

    case TIME_RANGE_PRESET.LAST_30_DAYS:
      return buildRange(subDays(anchor, 29), anchor, preset);

    case TIME_RANGE_PRESET.MONTH_TO_DATE:
      return buildRange(startOfMonth(anchor), anchor, preset);

    case TIME_RANGE_PRESET.QUARTER_TO_DATE:
      return buildRange(quarterStart(anchor), anchor, preset);

    case TIME_RANGE_PRESET.YEAR_TO_DATE:
      return buildRange(startOfYear(anchor), anchor, preset);

    case TIME_RANGE_PRESET.LAST_12_MONTHS:
      return buildRange(startOfMonth(subMonths(anchor, 11)), endOfMonth(anchor), preset);

    case TIME_RANGE_PRESET.THIS_WEEK:
      return buildRange(
        startOfWeek(anchor, { weekStartsOn: 1 }),
        endOfWeek(anchor, { weekStartsOn: 1 }),
        preset
      );

    default:
      return buildRange(subDays(anchor, 29), anchor, TIME_RANGE_PRESET.LAST_30_DAYS);
  }
}

export function getCustomRange(from, to) {
  const now = new Date();
  const safeFrom = normalizeDate(from, subDays(now, 29));
  const safeTo = normalizeDate(to, now);

  if (safeFrom.getTime() > safeTo.getTime()) {
    return buildRange(safeTo, safeFrom, TIME_RANGE_PRESET.CUSTOM);
  }

  return buildRange(safeFrom, safeTo, TIME_RANGE_PRESET.CUSTOM);
}

export function listTimeRangePresets() {
  return Object.values(TIME_RANGE_PRESET).map((value) => ({
    value,
    label: RANGE_LABELS[value] || value,
  }));
}

export function formatRangeLabel(range) {
  if (!range?.from || !range?.to) return "";
  return `${format(range.from, "MMM d, yyyy")} - ${format(range.to, "MMM d, yyyy")}`;
}

export function isWithinRange(value, range) {
  if (!range?.fromMs || !range?.toMs) return false;
  const dt = normalizeDate(value, null);
  if (!dt) return false;
  const ms = dt.getTime();
  return ms >= range.fromMs && ms <= range.toMs;
}

export function getGroupingGranularity(range) {
  if (!range?.fromMs || !range?.toMs) return "day";
  const days = Math.max(1, Math.ceil((range.toMs - range.fromMs) / (1000 * 60 * 60 * 24)));

  if (days <= 14) return "day";
  if (days <= 90) return "week";
  if (days <= 740) return "month";
  return "year";
}

export function getDefaultTimeRange(now = new Date()) {
  return getPresetRange(TIME_RANGE_PRESET.LAST_30_DAYS, now);
}

export function getYearBoundary(now = new Date()) {
  const anchor = normalizeDate(now, new Date());
  return {
    start: startOfYear(anchor),
    end: endOfYear(anchor),
  };
}

export function getRollingMonthBoundary(now = new Date()) {
  const anchor = normalizeDate(now, new Date());
  return {
    start: startOfMonth(subMonths(anchor, 11)),
    end: endOfMonth(anchor),
  };
}

export function getRollingYearBoundary(now = new Date()) {
  const anchor = normalizeDate(now, new Date());
  return {
    start: startOfDay(subYears(anchor, 1)),
    end: endOfDay(anchor),
  };
}
