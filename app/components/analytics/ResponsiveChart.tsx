"use client";

import {
  cloneElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

interface ResponsiveChartProps {
  /** Accepted for drop-in parity with recharts ResponsiveContainer; always treated as 100%. */
  width?: number | string;
  /** Number → fixed pixel height. "100%" → fill the parent's height. */
  height?: number | string;
  children: ReactElement<{ width?: number; height?: number }>;
}

/**
 * Drop-in replacement for recharts' `ResponsiveContainer`.
 *
 * recharts' own ResponsiveContainer measures its size lazily and, under React 19 /
 * Next 15, can paint a 0-width SVG on first mount when nothing triggers a re-measure
 * (the dashboard's charts dodge this only because react-grid-layout fires a resize).
 * This wrapper measures its container synchronously in `useLayoutEffect` (so
 * `clientWidth`/`clientHeight` are correct on first paint) plus a `ResizeObserver`
 * for later changes, then hands explicit numeric `width`/`height` to the chart —
 * so charts render on first mount without needing a resize.
 */
export function ResponsiveChart({ height = 300, children }: ResponsiveChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const styleHeight = typeof height === "number" ? height : "100%";

  return (
    <div ref={ref} style={{ width: "100%", height: styleHeight }}>
      {size.w > 0 && size.h > 0 ? cloneElement(children, { width: size.w, height: size.h }) : null}
    </div>
  );
}
