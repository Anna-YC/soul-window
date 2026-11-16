// 桌面小时钟位置约束：显示器热插拔/缩放变化后，不能把窗口留在不可见区域。
export interface WidgetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WidgetPoint {
  x: number;
  y: number;
}

/** 返回完全落在某块显示器工作区内的位置；无有效位置时回退主屏右上角。 */
export function resolveWidgetPosition(
  saved: WidgetPoint | null,
  displays: WidgetRect[],
  size: { width: number; height: number },
): WidgetPoint {
  const primary = displays[0];
  if (!primary) return { x: 0, y: 0 };
  const fallback = {
    x: primary.x + Math.max(0, primary.width - size.width - 20),
    y: primary.y + 12,
  };
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return fallback;

  const fullyVisible = displays.some(
    (d) =>
      saved.x >= d.x &&
      saved.y >= d.y &&
      saved.x + size.width <= d.x + d.width &&
      saved.y + size.height <= d.y + d.height,
  );
  return fullyVisible ? { x: saved.x, y: saved.y } : fallback;
}
