// 设置规范化：非有限数不能进入计时状态机（P1 回归）
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, type UserSettings } from '../src/shared/settings';

const NUMERIC_KEYS = ['reminderMinutes', 'forcedRestAfterMinutes', 'forcedRestDurationMinutes'] as const;

describe('sanitizeSettings 数值边界', () => {
  it('默认设置保持不变', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  for (const key of NUMERIC_KEYS) {
    it(`${key} 遇到 undefined / null / NaN / Infinity 时回退默认值`, () => {
      for (const invalid of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '30']) {
        const sanitized = sanitizeSettings({ [key]: invalid } as unknown as Partial<UserSettings>);
        expect(sanitized[key]).toBe(DEFAULT_SETTINGS[key]);
        expect(Number.isFinite(sanitized[key])).toBe(true);
      }
    });

    it(`${key} 的有限输入按步长取整并钳制范围`, () => {
      const zero = sanitizeSettings({ [key]: 0 });
      expect(Number.isFinite(zero[key])).toBe(true);
      expect(zero[key]).toBeGreaterThan(0);
    });
  }

  it('提醒阈值不大于强制休息阈值', () => {
    const s = sanitizeSettings({ reminderMinutes: 60, forcedRestAfterMinutes: 20 });
    expect(s.reminderMinutes).toBe(20);
    expect(s.forcedRestAfterMinutes).toBe(20);
  });

  it('多项无效输入同时出现时仍得到完整有限配置', () => {
    const s = sanitizeSettings({
      reminderMinutes: undefined,
      forcedRestAfterMinutes: Number.NaN,
      forcedRestDurationMinutes: null as unknown as number,
    });
    expect(s.reminderMinutes).toBe(30);
    expect(s.forcedRestAfterMinutes).toBe(40);
    expect(s.forcedRestDurationMinutes).toBe(5);
    expect(Number.isFinite(s.reminderMinutes * 60)).toBe(true);
    expect(Number.isFinite(s.forcedRestAfterMinutes * 60)).toBe(true);
    expect(Number.isFinite(s.forcedRestDurationMinutes * 60)).toBe(true);
  });
});
