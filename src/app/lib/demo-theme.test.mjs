import assert from "node:assert/strict";
import test from "node:test";

import { createDemoThemeTokens, getDemoThemeVariant } from "./demo-theme.ts";

test("maps OpenFeature color scheme details onto active Beacon theme tokens", () => {
  const tokens = createDemoThemeTokens({
    variant: "color_scheme_dark",
    value: {
      bgColor: "#111111",
      textColor: "#eeeeee",
      headingColor: "#60a5fa",
      borderColor: "#333333",
      codeBg: "#222222",
      codeText: "#ffffff",
    },
  });

  assert.equal(tokens["--page"], "#111111");
  assert.equal(tokens["--ink"], "#eeeeee");
  assert.equal(tokens["--accent"], "#00b4a6");
  assert.equal(tokens["--line"], "#333333");
  assert.equal(tokens["--code-bg"], "#0b1211");
  assert.equal(tokens["--code-text"], "#d9fff5");
});

test("detects dark variants from OpenFeature metadata", () => {
  assert.equal(getDemoThemeVariant({
    flagMetadata: {
      variant_name: "dark",
    },
  }), "dark");

  assert.equal(getDemoThemeVariant({
    variant: "color_scheme_control",
  }), "control");
});
