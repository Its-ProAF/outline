export type CalendarDay = {
  /** The day as YYYY-MM-DD. */
  date: string;
  /** False for the days of the neighbouring months that fill the first and last week. */
  inMonth: boolean;
};

/** Monday first, as the week is read in Italy. */
export const Weekdays = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];

/**
 * Formats a date as YYYY-MM-DD in the timezone of the reader, so that the day
 * shown and the day written on the issue are the same day.
 *
 * @param date the date to format.
 * @returns the day as YYYY-MM-DD.
 */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Returns the month a day belongs to.
 *
 * @param date the day as YYYY-MM-DD.
 * @returns the month as YYYY-MM.
 */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Moves a month backwards or forwards.
 *
 * @param key the month as YYYY-MM.
 * @param months how many months to move, negative to go back.
 * @returns the month reached, as YYYY-MM.
 */
export function shiftMonth(key: string, months: number): string {
  const [year, month] = key.split("-").map(Number);
  return monthOf(isoDate(new Date(year, month - 1 + months, 1)));
}

/**
 * Names a month in Italian.
 *
 * @param key the month as YYYY-MM.
 * @returns the month and the year, like "settembre 2026".
 */
export function monthTitle(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("it-IT", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Writes a day the way it is read in Italy.
 *
 * @param date the day as YYYY-MM-DD.
 * @returns the day like "15-10-2026".
 */
export function dayLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}-${month}-${year}`;
}

/**
 * Names a day in full, for the labels a screen reader reads out.
 *
 * @param date the day as YYYY-MM-DD.
 * @returns the day like "gioved\u00ec 15 ottobre 2026".
 */
export function dayTitle(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Builds the weeks of a month, each of seven days, filled at both ends with the
 * days of the neighbouring months.
 *
 * @param key the month as YYYY-MM.
 * @returns the weeks, from Monday to Sunday.
 */
export function weeksOf(key: string): CalendarDay[][] {
  const [year, month] = key.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const cursor = new Date(year, month - 1, 1 - ((first.getDay() + 6) % 7));
  const weeks: CalendarDay[][] = [];

  do {
    const week: CalendarDay[] = [];
    for (let day = 0; day < 7; day++) {
      week.push({
        date: isoDate(cursor),
        inMonth: cursor.getMonth() === month - 1,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === month - 1);

  return weeks;
}
