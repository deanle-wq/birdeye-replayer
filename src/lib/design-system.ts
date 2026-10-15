/** Beside control system with the approved Birdeye green brand scale. */
export const FONT_FAMILY = '"Aeonik Local", Geist, "Segoe UI", Arial, sans-serif';

export const BRAND_SCALE = {
  50: "#EDFFF7", 100: "#D5FFEF", 200: "#AEFFE0", 300: "#70FFCB",
  400: "#2BFDB1", 500: "#00FFA3", 600: "#00C07B", 700: "#009661",
  800: "#06754E", 900: "#076042", 950: "#003726",
} as const;
export const BRAND = { primary: BRAND_SCALE[500], ink: BRAND_SCALE[950] } as const;

export const LIGHT_THEME = {
  canvas: "#FAFBF7", surface: "#FFFFFF", subtle: "#F3F5EF", strong: "#172820",
  text: "#172820", secondary: "#526159", tertiary: "#69776E", inverse: "#FFFFFF",
  border: "#D9E0D5", borderSubtle: "#E8EDE5", borderStrong: "#AFBAB0", focus: BRAND_SCALE[800],
  success: BRAND_SCALE[800], successBg: BRAND_SCALE[100], warning: "#8C6108", warningBg: "#FFF5D5",
  danger: "#B94335", dangerBg: "#FFF0EC", info: "#285B90", infoBg: "#E9F1FD",
} as const;

export const DARK_THEME = {
  canvas: "#101010", surface: "#191919", subtle: "#242424", strong: "#F2F2F2",
  text: "#F3F3F3", secondary: "#B9B9B9", tertiary: "#969696", inverse: "#171717",
  border: "#3C3C3C", borderSubtle: "#2C2C2C", borderStrong: "#626262", focus: BRAND.primary,
  success: BRAND_SCALE[400], successBg: BRAND_SCALE[950], warning: "#ECC47B", warningBg: "#342A1E",
  danger: "#F4A39B", dangerBg: "#382421", info: "#A9CBF8", infoBg: "#252F3B",
} as const;

export function hexRgb(hex: string): string {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(", ");
}

/** Emit both modes at the root; CSS selects a mode through data-theme. */
export const DESIGN_CSS_VARIABLES = {
  ...Object.fromEntries(Object.entries(LIGHT_THEME).map(([key, value]) => [`--light-${key}`, value])),
  ...Object.fromEntries(Object.entries(DARK_THEME).map(([key, value]) => [`--dark-${key}`, value])),
  ...Object.fromEntries(Object.entries(BRAND_SCALE).map(([key, value]) => [`--brand-${key}`, value])),
  "--brand-primary": BRAND.primary,
  "--brand-ink": BRAND.ink,
  "--font-ui": FONT_FAMILY,
};
