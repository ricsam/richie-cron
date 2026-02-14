import CronExpressionParser, { CronDate } from '../src';

describe('browser-safe smoke', () => {
  test('parses and iterates expression without node builtins', () => {
    const interval = CronExpressionParser.parse('*/15 * * * *', {
      currentDate: '2026-01-01T00:00:00Z',
    });

    const next = interval.next();
    expect(next).toBeInstanceOf(CronDate);
    expect(next.toISOString()).toBe('2026-01-01T00:15:00.000Z');
  });
});
