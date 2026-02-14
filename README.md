# richie-cron

A cron parsing and iteration library inspired by [`cron-parser`](https://github.com/harrisiirak/cron-parser), implemented with `date-fns` + `@date-fns/tz` + `@date-fns/utc`.

## Goals

- Near-equivalent cron behavior to `cron-parser`.
- Pure JavaScript library (no cron-file parsing, no `fs` runtime dependency).
- Runtime compatibility with Node.js, Bun, and browser bundlers.

## Install

```bash
bun install
```

## Supported Cron Format

```text
*    *    *    *    *    *
┬    ┬    ┬    ┬    ┬    ┬
│    │    │    │    │    │
│    │    │    │    │    └─ day of week (0-7, 1L-7L) (0 or 7 is Sunday)
│    │    │    │    └────── month (1-12, JAN-DEC)
│    │    │    └─────────── day of month (1-31, L)
│    │    └──────────────── hour (0-23)
│    └───────────────────── minute (0-59)
└────────────────────────── second (0-59, optional)
```

### Special characters

- `*` any value
- `?` alias for `*`
- `,` list separator
- `-` range
- `/` step
- `L` last day of month/week
- `#` nth weekday of month
- `H` hash/jitter value (seedable with `hashSeed`)

### Predefined expressions

- `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@hourly`, `@minutely`, `@secondly`, `@weekdays`, `@weekends`

## Usage

```ts
import { CronExpressionParser } from 'richie-cron';

const interval = CronExpressionParser.parse('*/5 * * * *', {
  currentDate: '2026-01-01T00:00:00Z',
  tz: 'Europe/London',
});

console.log(interval.next().toISOString());
console.log(interval.take(3).map((d) => d.toISOString()));
```

## API

Primary exports:

- `CronExpressionParser` (default + named)
- `CronExpression`
- `CronDate`
- `CronFieldCollection`
- `CronSecond`, `CronMinute`, `CronHour`, `CronDayOfMonth`, `CronMonth`, `CronDayOfWeek`
- parser enums/types (`PredefinedExpressions`, `CronUnit`, aliases, options types)

## Timezone behavior

- If `tz` is provided, iteration and matching are evaluated in that timezone.
- If `tz` is omitted, scheduling defaults to `UTC`.

## Not included

- `CronFileParser`
- Any file parsing helpers

This package is intentionally pure scheduling/parsing logic.

## Test

```bash
bun test
```
