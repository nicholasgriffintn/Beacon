export type DemoThemeVariant = "control" | "dark";

export type DemoThemeDetails = {
  value?: Record<string, unknown>;
  variant?: string;
  flagMetadata?: Record<string, unknown>;
};

export const DEMO_TARGETING_KEYS: Record<DemoThemeVariant, string> = {
  control: "demo-light",
  dark: "demo-dark",
};

function readStringValue(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function getDemoThemeVariant(details: DemoThemeDetails): DemoThemeVariant {
  const metadata = details.flagMetadata || {};
  const variant = String(
    metadata.variant_name ||
      metadata.variant_id ||
      details.variant ||
      "",
  ).toLowerCase();

  return variant.includes("dark") ? "dark" : "control";
}

export function createDemoThemeTokens(details: DemoThemeDetails): Record<string, string> {
  const config = details.value && typeof details.value === "object" ? details.value : {};
  const variant = getDemoThemeVariant(details);

  if (variant === "dark") {
    return {
      "--page": readStringValue(config, "bgColor", "#101817"),
      "--page-soft": "#16211f",
      "--ink": readStringValue(config, "textColor", "#e5e7eb"),
      "--muted": "#a7b2ad",
      "--line": readStringValue(config, "borderColor", "#374151"),
      "--panel": "rgba(19, 29, 27, 0.92)",
      "--panel-strong": "#17211f",
      "--nav": "#081210",
      "--nav-2": "#0e211d",
      "--accent": "#00b4a6",
      "--code-bg": "#0b1211",
      "--code-text": "#d9fff5",
      "--body-accent": "rgba(0, 180, 166, 0.14)",
      "--body-start": "#101817",
      "--body-mid": "#17211f",
      "--body-end": "#0b1211",
      "--nav-link": "#d8e3df",
      "--hover-surface": "rgba(255, 255, 255, 0.08)",
      "--meter-track": "#26322f",
    };
  }

  return {
    "--page": readStringValue(config, "bgColor", "#f4efe6"),
    "--page-soft": "#fffaf0",
    "--ink": readStringValue(config, "textColor", "#161817"),
    "--muted": "#6b6258",
    "--line": readStringValue(config, "borderColor", "#d8cab8"),
    "--panel": "rgba(255, 252, 246, 0.9)",
    "--panel-strong": "#fffdf8",
    "--nav": "#10201d",
    "--nav-2": "#1b302b",
    "--accent": "#008f83",
    "--code-bg": readStringValue(config, "codeBg", "#111918"),
    "--code-text": readStringValue(config, "codeText", "#d9fff5"),
    "--body-accent": "rgba(0, 143, 131, 0.18)",
    "--body-start": "#f7eddb",
    "--body-mid": "#fffaf0",
    "--body-end": "#e8dcc9",
    "--nav-link": "#443d34",
    "--hover-surface": "rgba(16, 32, 29, 0.08)",
    "--meter-track": "#e7ded1",
  };
}
