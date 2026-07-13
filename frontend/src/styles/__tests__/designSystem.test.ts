import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokensPath = resolve(process.cwd(), "src/styles/tokens.css");
const motionPath = resolve(process.cwd(), "src/styles/motion.css");

function readRequiredFile(path: string): string {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8");
}

describe("design system contract", () => {
  it("preserves the supplied light and dark brand palettes", () => {
    const css = readRequiredFile(tokensPath);

    for (const color of [
      "#de283b",
      "#ff6366",
      "#ffccc4",
      "#25b1bf",
      "#005461",
      "#ffffff",
      "#f5f5f5",
      "#cccccc",
      "#FF6600",
      "#ff983f",
      "#ffffa1",
      "#F5F5F5",
      "#929292",
      "#1D1F21",
      "#2c2e30",
      "#444648",
    ]) {
      expect(css).toContain(color);
    }
  });

  it("defines semantic surface, text, border, elevation, and layer tokens", () => {
    const css = readRequiredFile(tokensPath);

    for (const token of [
      "--canvas:",
      "--surface-1:",
      "--surface-2:",
      "--surface-3:",
      "--surface-elevated:",
      "--overlay:",
      "--text-strong:",
      "--text-default:",
      "--text-muted:",
      "--text-disabled:",
      "--border-subtle:",
      "--border-default:",
      "--border-strong:",
      "--focus-ring:",
      "--shadow-xs:",
      "--shadow-sm:",
      "--shadow-md:",
      "--shadow-lg:",
      "--shadow-overlay:",
      "--layer-navigation:",
      "--layer-menu:",
      "--layer-dialog:",
      "--layer-toast:",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("defines explicit motion recipes and reduced-motion behavior", () => {
    const css = readRequiredFile(motionPath);

    for (const token of [
      "--duration-instant:",
      "--duration-fast:",
      "--duration-base:",
      "--duration-slow:",
      "--duration-drawer:",
      "--ease-standard:",
      "--ease-emphasized:",
      "--ease-exit:",
    ]) {
      expect(css).toContain(token);
    }

    expect(css).toContain('[data-floating-layer][data-state="opening"]');
    expect(css).toContain('[data-floating-layer][data-state="closing"]');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toContain("transition: all");
  });
});
