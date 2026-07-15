import { useEffect, useRef } from "react";
import { echarts } from "@/lib/echarts";
import { getChartTheme } from "@/lib/chart-theme";
import { useDarkMode } from "@/hooks/useDarkMode";
import type { UsageTimeseriesPoint } from "@/lib/api";

interface UsageTrendChartProps {
  points: UsageTimeseriesPoint[];
  tokenLabel: string;
  latencyLabel: string;
  height?: number;
}

export function UsageTrendChart({ points, tokenLabel, latencyLabel, height = 240 }: UsageTrendChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { dark } = useDarkMode();

  useEffect(() => {
    if (!ref.current) return;

    const theme = getChartTheme();
    const chart = echarts.init(ref.current);
    chart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        textStyle: { color: theme.tooltipText, fontSize: 11 },
        valueFormatter: (value: number | string) => Number(value || 0).toLocaleString(),
      },
      legend: {
        data: [tokenLabel, latencyLabel],
        right: 4,
        top: 0,
        textStyle: { color: theme.textColor, fontSize: 11 },
      },
      grid: { left: 4, right: 4, top: 38, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: points.map((point) => point.date.slice(5)),
        boundaryGap: true,
        axisLine: { lineStyle: { color: theme.axisColor } },
        axisLabel: { color: theme.textColor, fontSize: 10, interval: Math.max(0, Math.ceil(points.length / 7) - 1) },
      },
      yAxis: [
        {
          type: "value",
          splitLine: { lineStyle: { color: theme.gridColor } },
          axisLabel: { color: theme.textColor, fontSize: 10, formatter: (value: number) => abbreviate(value) },
        },
        {
          type: "value",
          splitLine: { show: false },
          axisLabel: { color: theme.textColor, fontSize: 10, formatter: "{value} ms" },
        },
      ],
      series: [
        {
          name: tokenLabel,
          type: "bar",
          data: points.map((point) => point.total_tokens),
          itemStyle: { color: theme.primaryColor, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 22,
        },
        {
          name: latencyLabel,
          type: "line",
          yAxisIndex: 1,
          data: points.map((point) => point.average_latency_ms),
          symbol: "circle",
          symbolSize: 5,
          smooth: true,
          lineStyle: { color: theme.accentColor, width: 2 },
          itemStyle: { color: theme.accentColor },
        },
      ],
    });

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [dark, latencyLabel, points, tokenLabel]);

  return <div ref={ref} style={{ height }} aria-label={`${tokenLabel} and ${latencyLabel}`} />;
}

function abbreviate(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}
