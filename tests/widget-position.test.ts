// 桌面小时钟可见区域回归（P3）
import { describe, expect, it } from 'vitest';
import { resolveWidgetPosition } from '../electron/widget-position';

const displays = [
  { x: 0, y: 0, width: 1710, height: 1073 }, // 主屏工作区
  { x: 1710, y: 0, width: 1920, height: 1080 }, // 扩展屏
];
const size = { width: 232, height: 64 };
const fallback = { x: 1710 - 232 - 20, y: 12 };

describe('resolveWidgetPosition', () => {
  it('无历史位置时使用主屏右上角', () => {
    expect(resolveWidgetPosition(null, displays, size)).toEqual(fallback);
  });

  it('保留仍完全可见的用户拖动位置（含扩展屏）', () => {
    expect(resolveWidgetPosition({ x: 1800, y: 100 }, displays, size)).toEqual({ x: 1800, y: 100 });
  });

  it('扩展屏拔掉后，落在旧扩展屏的位置回退主屏', () => {
    expect(resolveWidgetPosition({ x: 1800, y: 100 }, [displays[0]], size)).toEqual(fallback);
  });

  it('位置超出所有工作区时回退主屏', () => {
    expect(resolveWidgetPosition({ x: -9999, y: 9999 }, displays, size)).toEqual(fallback);
  });

  it('部分越界或非有限坐标也回退主屏', () => {
    expect(resolveWidgetPosition({ x: 1650, y: 100 }, displays, size)).toEqual(fallback);
    expect(resolveWidgetPosition({ x: Number.NaN, y: 100 }, displays, size)).toEqual(fallback);
  });
});
