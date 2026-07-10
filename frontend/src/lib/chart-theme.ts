function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hslToHex(hsl: string): string {
  if (!hsl) return "";
  const [h, s, l] = hsl.split(/\s+/).map(parseFloat);
  if (isNaN(h)) return "";
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function tokenHex(name: string, fallback: string): string {
  const value = css(name);
  return value.startsWith("#") ? value : hslToHex(value) || fallback;
}

function isChinese(): boolean {
  return (document.documentElement.lang || navigator.language || "").startsWith("zh");
}

let _cache: ReturnType<typeof buildTheme> | null = null;
let _cacheKey = "";

function buildTheme() {
  const cn = isChinese();
  const isDark = document.documentElement.classList.contains("dark");

  const primaryHex = tokenHex("--primary-100", isDark ? "#FF6600" : "#de283b");
  const primarySoftHex = tokenHex("--primary-200", isDark ? "#ff983f" : "#ff6366");
  const primaryPaleHex = tokenHex("--primary-300", isDark ? "#ffffa1" : "#ffccc4");
  const accentHex = tokenHex("--accent-100", isDark ? "#F5F5F5" : "#25b1bf");
  const accentDeepHex = tokenHex("--accent-200", isDark ? "#929292" : "#005461");
  const neutralHex = tokenHex("--bg-300", isDark ? "#444648" : "#cccccc");
  const successHex = hslToHex(css("--success")) || accentHex;
  const dangerHex = hslToHex(css("--danger")) || primaryHex;
  const infoHex = hslToHex(css("--info")) || accentHex;
  const warningHex = hslToHex(css("--warning")) || primarySoftHex;
  const gridHex = hslToHex(css("--chart-grid")) || neutralHex;
  const textHex = hslToHex(css("--chart-text")) || tokenHex("--text-200", isDark ? "#e0e0e0" : "#404040");
  const axisHex = hslToHex(css("--chart-axis")) || neutralHex;

  // Locale-aware candlestick colors: China = red up / green down
  const upHex = cn ? dangerHex : successHex;
  const downHex = cn ? successHex : dangerHex;

  return {
    gridColor: gridHex,
    textColor: textHex,
    axisColor: axisHex,
    upColor: upHex,
    downColor: downHex,
    maColors: [primaryHex, accentHex, primarySoftHex, accentDeepHex, neutralHex, warningHex, infoHex],
    bollColor: isDark ? "rgba(255,152,63,0.55)" : "rgba(37,177,191,0.5)",
    volumeUp: upHex + "66",
    volumeDown: downHex + "66",
    infoColor: infoHex,
    warningColor: warningHex,
    primaryColor: primaryHex,
    primarySoftColor: primarySoftHex,
    primaryPaleColor: primaryPaleHex,
    accentColor: accentHex,
    accentDeepColor: accentDeepHex,
    neutralColor: neutralHex,
    tooltipBg: isDark ? "rgba(29,31,33,0.94)" : "rgba(255,255,255,0.96)",
    tooltipBorder: gridHex,
    tooltipText: textHex,
  };
}

export function getChartTheme() {
  const key = `${document.documentElement.className}|${document.documentElement.lang || navigator.language}`;
  if (_cache && _cacheKey === key) return _cache;
  _cache = buildTheme();
  _cacheKey = key;
  return _cache;
}
