import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addSeconds,
  addYears,
  endOfDay,
  endOfHour,
  endOfMinute,
  endOfMonth,
  isValid,
  parse,
  parseISO,
  setDate as setDateValue,
  setHours as setHoursValue,
  setMilliseconds as setMillisecondsValue,
  setMinutes as setMinutesValue,
  setMonth as setMonthValue,
  setSeconds as setSecondsValue,
  setYear,
  startOfDay,
  startOfHour,
  startOfMinute,
  startOfMonth,
  startOfSecond,
  subDays,
  subHours,
  subMinutes,
  subMonths,
  subSeconds,
  subYears,
} from 'date-fns';
import { TZDate, tz } from '@date-fns/tz';
import { tzScan } from '@date-fns/tz/tzScan';
import { utc } from '@date-fns/utc';

export enum TimeUnit {
  Second = 'Second',
  Minute = 'Minute',
  Hour = 'Hour',
  Day = 'Day',
  Month = 'Month',
  Year = 'Year',
}

export enum DateMathOp {
  Add = 'Add',
  Subtract = 'Subtract',
}

type VerbMap = {
  [key in TimeUnit]: () => void;
};

export const DAYS_IN_MONTH: readonly number[] = Object.freeze([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

type ContextFn = (value: Date | number | string) => Date;
type ClockParts = {
  hour: number;
  minute: number;
  second: number;
};

/**
 * CronDate class that wraps Date-compatible values to provide
 * a consistent API for working with dates and times in the context of cron.
 */
export class CronDate {
  #date: Date;
  #tz?: string;
  #dstStart: number | null = null;
  #dstEnd: number | null = null;

  /**
   * Maps the verb to the appropriate method.
   */
  #verbMap: { add: VerbMap; subtract: VerbMap } = {
    add: {
      [TimeUnit.Year]: this.addYear.bind(this),
      [TimeUnit.Month]: this.addMonth.bind(this),
      [TimeUnit.Day]: this.addDay.bind(this),
      [TimeUnit.Hour]: this.addHour.bind(this),
      [TimeUnit.Minute]: this.addMinute.bind(this),
      [TimeUnit.Second]: this.addSecond.bind(this),
    },
    subtract: {
      [TimeUnit.Year]: this.subtractYear.bind(this),
      [TimeUnit.Month]: this.subtractMonth.bind(this),
      [TimeUnit.Day]: this.subtractDay.bind(this),
      [TimeUnit.Hour]: this.subtractHour.bind(this),
      [TimeUnit.Minute]: this.subtractMinute.bind(this),
      [TimeUnit.Second]: this.subtractSecond.bind(this),
    },
  };

  /**
   * Constructs a new CronDate instance.
   * @param {CronDate | Date | number | string} [timestamp] - The timestamp to initialize the CronDate with.
   * @param {string} [tzName] - The timezone to use for the CronDate.
   */
  constructor(timestamp?: CronDate | Date | number | string, tzName?: string) {
    if (!timestamp) {
      this.#tz = tzName;
      this.#date = this.#fromInstant(Date.now(), this.#tz);
    } else if (timestamp instanceof CronDate) {
      this.#dstStart = timestamp.#dstStart;
      this.#dstEnd = timestamp.#dstEnd;
      this.#tz = tzName ?? timestamp.#tz;
      this.#date = this.#fromInstant(timestamp.getTime(), this.#tz);
    } else {
      this.#tz = tzName;

      if (timestamp instanceof Date) {
        this.#date = this.#fromInstant(timestamp.getTime(), this.#tz);
      } else if (typeof timestamp === 'number') {
        this.#date = this.#fromInstant(timestamp, this.#tz);
      } else {
        this.#date = this.#parseStringTimestamp(timestamp, this.#tz);
      }
    }

    if (!this.#isValidDate(this.#date)) {
      throw new Error(`CronDate: unhandled timestamp: ${timestamp}`);
    }
  }

  /**
   * Determines if the given year is a leap year.
   * @param {number} year - The year to check.
   * @returns {boolean} - True if the year is a leap year, false otherwise.
   */
  static #isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  #contextFn(): ContextFn | undefined {
    if (this.#tz === 'UTC') {
      return utc;
    }
    if (this.#tz) {
      return tz(this.#tz);
    }
    return undefined;
  }

  #contextOptions(): { in: ContextFn } | undefined {
    const inContext = this.#contextFn();
    return inContext ? { in: inContext } : undefined;
  }

  #normalizeDate(date: Date): Date {
    return this.#fromInstant(date.getTime(), this.#tz);
  }

  #fromInstant(timestamp: number, tzName?: string): Date {
    if (tzName === 'UTC') {
      return utc(timestamp);
    }
    if (tzName) {
      return new TZDate(timestamp, tzName);
    }
    return new Date(timestamp);
  }

  #isValidDate(date: Date): boolean {
    return isValid(date);
  }

  #parseWithFormat(
    value: string,
    format: string,
    referenceDate: Date,
    options?: { in: ContextFn },
  ): Date | null {
    const parsed = parse(value, format, referenceDate, options);
    return this.#isValidDate(parsed) ? parsed : null;
  }

  #localClockParts(date: Date, tzName?: string): ClockParts {
    const localized = this.#fromInstant(date.getTime(), tzName);
    return {
      hour: localized.getHours(),
      minute: localized.getMinutes(),
      second: localized.getSeconds(),
    };
  }

  #isSameClock(lhs: ClockParts, rhs: ClockParts): boolean {
    return lhs.hour === rhs.hour && lhs.minute === rhs.minute && lhs.second === rhs.second;
  }

  #clockToSeconds(clock: ClockParts): number {
    return clock.hour * 3600 + clock.minute * 60 + clock.second;
  }

  #startOfHourByClock(date: Date): Date {
    const localized = this.#fromInstant(date.getTime(), this.#tz);
    const diffMs =
      ((localized.getMinutes() * 60 + localized.getSeconds()) * 1_000) + localized.getMilliseconds();
    return this.#fromInstant(date.getTime() - diffMs, this.#tz);
  }

  #startOfMinuteByClock(date: Date): Date {
    const localized = this.#fromInstant(date.getTime(), this.#tz);
    const diffMs = localized.getSeconds() * 1_000 + localized.getMilliseconds();
    return this.#fromInstant(date.getTime() - diffMs, this.#tz);
  }

  #endOfHourByClock(date: Date): Date {
    return this.#fromInstant(this.#startOfHourByClock(date).getTime() + 3_599_000, this.#tz);
  }

  #endOfMinuteByClock(date: Date): Date {
    return this.#fromInstant(this.#startOfMinuteByClock(date).getTime() + 59_000, this.#tz);
  }

  #adjustDstGap(date: Date, expectedClock: ClockParts, tzName?: string): Date {
    if (!tzName || tzName === 'UTC') {
      return date;
    }

    const actualClock = this.#localClockParts(date, tzName);
    if (this.#isSameClock(actualClock, expectedClock)) {
      return date;
    }

    // On DST-start gap parsing, date-fns/tz can normalize to an earlier hour.
    // If that happens, move forward by the DST change amount on that day.
    if (this.#clockToSeconds(actualClock) >= this.#clockToSeconds(expectedClock)) {
      return date;
    }

    const localDate = this.#fromInstant(date.getTime(), tzName);
    const start = new TZDate(localDate, tzName);
    start.setHours(0, 0, 0, 0);
    const end = new TZDate(localDate, tzName);
    end.setHours(23, 59, 59, 999);

    const forwardChange = tzScan(tzName, { start, end }).find((change) => change.change > 0);
    if (!forwardChange) {
      return date;
    }

    return this.#fromInstant(date.getTime() + forwardChange.change * 60_000, tzName);
  }

  #parseStringTimestamp(timestamp: string, tzName?: string): Date {
    const options = tzName ? { in: tzName === 'UTC' ? utc : tz(tzName) } : undefined;
    const referenceDate = options?.in ? options.in(Date.now()) : new Date();

    const isoDateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
    const isoNoOffsetPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;
    const isoWithOffsetPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

    if (isoDateOnlyPattern.test(timestamp) || isoNoOffsetPattern.test(timestamp) || isoWithOffsetPattern.test(timestamp)) {
      const isoDate = parseISO(timestamp, options as Parameters<typeof parseISO>[1]);
      if (this.#isValidDate(isoDate)) {
        if (isoNoOffsetPattern.test(timestamp) && tzName) {
          const [, hour, minute, second] = timestamp.match(/T(\d{2}):(\d{2}):(\d{2})/) ?? [];
          const adjusted = this.#adjustDstGap(
            isoDate,
            {
              hour: Number(hour),
              minute: Number(minute),
              second: Number(second),
            },
            tzName,
          );
          return this.#normalizeDate(adjusted);
        }
        return this.#normalizeDate(isoDate);
      }
    }

    const rfcDate = this.#parseWithFormat(timestamp, 'EEE, d MMM yyyy HH:mm:ss xx', referenceDate, options);
    if (rfcDate) {
      return this.#normalizeDate(rfcDate);
    }

    const rfcNoOffsetDate = this.#parseWithFormat(timestamp, 'EEE, d MMM yyyy HH:mm:ss', referenceDate, options);
    if (rfcNoOffsetDate) {
      const [, hour, minute, second] =
        timestamp.match(/(?:\d{4}\s+)?(\d{2}):(\d{2}):(\d{2})$/) ?? [];
      const adjusted = this.#adjustDstGap(
        rfcNoOffsetDate,
        {
          hour: Number(hour),
          minute: Number(minute),
          second: Number(second),
        },
        tzName,
      );
      return this.#normalizeDate(adjusted);
    }

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp)) {
      const sqlDate = this.#parseWithFormat(timestamp, 'yyyy-MM-dd HH:mm:ss', referenceDate, options);
      if (sqlDate) {
        const [, hour, minute, second] = timestamp.match(/(\d{2}):(\d{2}):(\d{2})$/) ?? [];
        const adjusted = this.#adjustDstGap(
          sqlDate,
          {
            hour: Number(hour),
            minute: Number(minute),
            second: Number(second),
          },
          tzName,
        );
        return this.#normalizeDate(adjusted);
      }
    }

    throw new Error(`CronDate: unhandled timestamp: ${timestamp}`);
  }

  /**
   * Returns daylight savings start time.
   */
  get dstStart(): number | null {
    return this.#dstStart;
  }

  /**
   * Sets daylight savings start time.
   */
  set dstStart(value: number | null) {
    this.#dstStart = value;
  }

  /**
   * Returns daylight savings end time.
   */
  get dstEnd(): number | null {
    return this.#dstEnd;
  }

  /**
   * Sets daylight savings end time.
   */
  set dstEnd(value: number | null) {
    this.#dstEnd = value;
  }

  /**
   * Adds one year to the current CronDate.
   */
  addYear(): void {
    this.#date = this.#normalizeDate(addYears(this.#date, 1, this.#contextOptions()));
  }

  /**
   * Adds one month to the current CronDate.
   */
  addMonth(): void {
    const options = this.#contextOptions();
    this.#date = this.#normalizeDate(startOfMonth(addMonths(this.#date, 1, options), options));
  }

  /**
   * Adds one day to the current CronDate.
   */
  addDay(): void {
    const options = this.#contextOptions();
    this.#date = this.#normalizeDate(startOfDay(addDays(this.#date, 1, options), options));
  }

  /**
   * Adds one hour to the current CronDate.
   */
  addHour(): void {
    const shifted = this.#fromInstant(this.getTime() + 3_600_000, this.#tz);
    this.#date = this.#normalizeDate(this.#startOfHourByClock(shifted));
  }

  /**
   * Adds one minute to the current CronDate.
   */
  addMinute(): void {
    const shifted = this.#fromInstant(this.getTime() + 60_000, this.#tz);
    this.#date = this.#normalizeDate(this.#startOfMinuteByClock(shifted));
  }

  /**
   * Adds one second to the current CronDate.
   */
  addSecond(): void {
    this.#date = this.#normalizeDate(this.#fromInstant(this.getTime() + 1_000, this.#tz));
  }

  /**
   * Subtracts one year from the current CronDate.
   */
  subtractYear(): void {
    this.#date = this.#normalizeDate(subYears(this.#date, 1, this.#contextOptions()));
  }

  /**
   * Subtracts one month from the current CronDate.
   */
  subtractMonth(): void {
    const options = this.#contextOptions();
    this.#date = this.#normalizeDate(startOfSecond(endOfMonth(subMonths(this.#date, 1, options), options), options));
  }

  /**
   * Subtracts one day from the current CronDate.
   */
  subtractDay(): void {
    const options = this.#contextOptions();
    this.#date = this.#normalizeDate(startOfSecond(endOfDay(subDays(this.#date, 1, options), options), options));
  }

  /**
   * Subtracts one hour from the current CronDate.
   */
  subtractHour(): void {
    const shifted = this.#fromInstant(this.getTime() - 3_600_000, this.#tz);
    this.#date = this.#normalizeDate(this.#endOfHourByClock(shifted));
  }

  /**
   * Subtracts one minute from the current CronDate.
   */
  subtractMinute(): void {
    const shifted = this.#fromInstant(this.getTime() - 60_000, this.#tz);
    this.#date = this.#normalizeDate(this.#endOfMinuteByClock(shifted));
  }

  /**
   * Subtracts one second from the current CronDate.
   */
  subtractSecond(): void {
    this.#date = this.#normalizeDate(this.#fromInstant(this.getTime() - 1_000, this.#tz));
  }

  /**
   * Adds a unit of time to the current CronDate.
   */
  addUnit(unit: TimeUnit): void {
    this.#verbMap.add[unit]();
  }

  /**
   * Subtracts a unit of time from the current CronDate.
   */
  subtractUnit(unit: TimeUnit): void {
    this.#verbMap.subtract[unit]();
  }

  /**
   * Handles a math operation.
   */
  invokeDateOperation(verb: DateMathOp, unit: TimeUnit) {
    if (verb === DateMathOp.Add) {
      this.addUnit(unit);
      return;
    }
    if (verb === DateMathOp.Subtract) {
      this.subtractUnit(unit);
      return;
    }
    throw new Error(`Invalid verb: ${verb}`);
  }

  /**
   * Returns the day.
   */
  getDate(): number {
    return this.#date.getDate();
  }

  /**
   * Returns the year.
   */
  getFullYear(): number {
    return this.#date.getFullYear();
  }

  /**
   * Returns the day of the week.
   */
  getDay(): number {
    return this.#date.getDay();
  }

  /**
   * Returns the month.
   */
  getMonth(): number {
    return this.#date.getMonth();
  }

  /**
   * Returns the hour.
   */
  getHours(): number {
    return this.#date.getHours();
  }

  /**
   * Returns the minutes.
   */
  getMinutes(): number {
    return this.#date.getMinutes();
  }

  /**
   * Returns the seconds.
   */
  getSeconds(): number {
    return this.#date.getSeconds();
  }

  /**
   * Returns the milliseconds.
   */
  getMilliseconds(): number {
    return this.#date.getMilliseconds();
  }

  /**
   * Returns the timezone offset from UTC in minutes (e.g. UTC+2 => 120).
   */
  getUTCOffset(): number {
    return -this.#date.getTimezoneOffset();
  }

  /**
   * Sets the time to the start of the day (00:00:00.000) in the current timezone.
   */
  setStartOfDay(): void {
    this.#date = this.#normalizeDate(startOfDay(this.#date, this.#contextOptions()));
  }

  /**
   * Sets the time to the end of the day (23:59:59.999) in the current timezone.
   */
  setEndOfDay(): void {
    this.#date = this.#normalizeDate(endOfDay(this.#date, this.#contextOptions()));
  }

  /**
   * Returns the time.
   */
  getTime(): number {
    return this.#date.getTime();
  }

  /**
   * Returns the UTC day.
   */
  getUTCDate(): number {
    return this.#getUTC().getUTCDate();
  }

  /**
   * Returns the UTC year.
   */
  getUTCFullYear(): number {
    return this.#getUTC().getUTCFullYear();
  }

  /**
   * Returns the UTC day of the week.
   */
  getUTCDay(): number {
    return this.#getUTC().getUTCDay();
  }

  /**
   * Returns the UTC month.
   */
  getUTCMonth(): number {
    return this.#getUTC().getUTCMonth();
  }

  /**
   * Returns the UTC hour.
   */
  getUTCHours(): number {
    return this.#getUTC().getUTCHours();
  }

  /**
   * Returns the UTC minutes.
   */
  getUTCMinutes(): number {
    return this.#getUTC().getUTCMinutes();
  }

  /**
   * Returns the UTC seconds.
   */
  getUTCSeconds(): number {
    return this.#getUTC().getUTCSeconds();
  }

  /**
   * Returns the UTC milliseconds.
   */
  toISOString(): string {
    return this.#getUTC().toISOString();
  }

  /**
   * Returns the date as a JSON string.
   */
  toJSON(): string {
    return this.#getUTC().toJSON();
  }

  /**
   * Sets the day.
   */
  setDate(d: number): void {
    this.#date = this.#normalizeDate(setDateValue(this.#date, d, this.#contextOptions()));
  }

  /**
   * Sets the year.
   */
  setFullYear(y: number): void {
    this.#date = this.#normalizeDate(setYear(this.#date, y, this.#contextOptions()));
  }

  /**
   * Sets the day of the week.
   */
  setDay(d: number): void {
    const targetDay = ((d % 7) + 7) % 7;
    const dayDiff = targetDay - this.getDay();
    this.#date = this.#normalizeDate(addDays(this.#date, dayDiff, this.#contextOptions()));
  }

  /**
   * Sets the month.
   */
  setMonth(m: number): void {
    this.#date = this.#normalizeDate(setMonthValue(this.#date, m, this.#contextOptions()));
  }

  /**
   * Sets the hour.
   */
  setHours(h: number): void {
    if (this.getHours() === h) {
      return;
    }
    this.#date = this.#normalizeDate(setHoursValue(this.#date, h, this.#contextOptions()));
  }

  /**
   * Sets the minutes.
   */
  setMinutes(m: number): void {
    if (this.getMinutes() === m) {
      return;
    }
    this.#date = this.#normalizeDate(setMinutesValue(this.#date, m, this.#contextOptions()));
  }

  /**
   * Sets the seconds.
   */
  setSeconds(s: number): void {
    if (this.getSeconds() === s) {
      return;
    }
    this.#date = this.#normalizeDate(setSecondsValue(this.#date, s, this.#contextOptions()));
  }

  /**
   * Sets the milliseconds.
   */
  setMilliseconds(s: number): void {
    if (this.getMilliseconds() === s) {
      return;
    }
    this.#date = this.#normalizeDate(setMillisecondsValue(this.#date, s, this.#contextOptions()));
  }

  /**
   * Returns the date as a string.
   */
  toString(): string {
    return this.toDate().toString();
  }

  /**
   * Returns the date as a Date object.
   */
  toDate(): Date {
    return new Date(this.#date.getTime());
  }

  /**
   * Returns true if the day is the last day of the month.
   */
  isLastDayOfMonth(): boolean {
    const day = this.getDate();
    const month = this.getMonth() + 1;
    const year = this.getFullYear();

    if (month === 2) {
      const isLeap = CronDate.#isLeapYear(year);
      return day === DAYS_IN_MONTH[month - 1] - (isLeap ? 0 : 1);
    }

    return day === DAYS_IN_MONTH[month - 1];
  }

  /**
   * Returns true if the day is the last weekday of the month.
   */
  isLastWeekdayOfMonth(): boolean {
    const day = this.getDate();
    const month = this.getMonth() + 1;
    const year = this.getFullYear();

    let lastDay: number;
    if (month === 2) {
      lastDay = DAYS_IN_MONTH[month - 1] - (CronDate.#isLeapYear(year) ? 0 : 1);
    } else {
      lastDay = DAYS_IN_MONTH[month - 1];
    }

    return day > lastDay - 7;
  }

  /**
   * Primarily for internal use.
   */
  applyDateOperation(op: DateMathOp, unit: TimeUnit, hoursLength?: number): void {
    if (unit === TimeUnit.Month || unit === TimeUnit.Day) {
      this.invokeDateOperation(op, unit);
      return;
    }

    const previousHour = this.getHours();
    this.invokeDateOperation(op, unit);
    const currentHour = this.getHours();
    const diff = currentHour - previousHour;

    if (diff === 2) {
      if (hoursLength !== 24) {
        this.dstStart = currentHour;
      }
    } else if (diff === 0 && this.getMinutes() === 0 && this.getSeconds() === 0) {
      if (hoursLength !== 24) {
        this.dstEnd = currentHour;
      }
    }
  }

  /**
   * Returns the UTC date.
   */
  #getUTC(): Date {
    return new Date(this.#date.getTime());
  }
}

export default CronDate;
