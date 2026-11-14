export const QR_COLOR_THEMES = [
  { id: 'matrix', name: 'Matrix', foreground: '#39FF14', background: '#071A12' },
  { id: 'classic', name: 'Classic', foreground: '#111111', background: '#FFFFFF' },
  { id: 'ocean', name: 'Ocean', foreground: '#55C8FF', background: '#0B1B3A' },
  { id: 'purple', name: 'Purple', foreground: '#D9A7FF', background: '#241038' },
  { id: 'ruby', name: 'Ruby', foreground: '#FFB0B8', background: '#3A1018' },
  { id: 'emerald', name: 'Emerald', foreground: '#A7FFE4', background: '#07352D' },
];

export const CUSTOM_QR_THEME_ID = 'custom';

export function getQrColorTheme(themeId) {
  return QR_COLOR_THEMES.find((theme) => theme.id === themeId);
}

export function inferQrColorThemeId(foreground, background) {
  const theme = QR_COLOR_THEMES.find((candidate) => (
    candidate.foreground.toLowerCase() === foreground.toLowerCase()
    && candidate.background.toLowerCase() === background.toLowerCase()
  ));
  return theme?.id ?? CUSTOM_QR_THEME_ID;
}

export function isQrColorThemeCompatible(themeId, foreground, background) {
  if (themeId === undefined || themeId === CUSTOM_QR_THEME_ID) return true;
  const theme = getQrColorTheme(themeId);
  return Boolean(
    theme
    && theme.foreground.toLowerCase() === foreground.toLowerCase()
    && theme.background.toLowerCase() === background.toLowerCase(),
  );
}

export function getQrColorThemeId(settings) {
  if (settings.colorTheme === CUSTOM_QR_THEME_ID) return CUSTOM_QR_THEME_ID;
  if (isQrColorThemeCompatible(settings.colorTheme, settings.foreground, settings.background)) {
    return settings.colorTheme ?? inferQrColorThemeId(settings.foreground, settings.background);
  }
  return inferQrColorThemeId(settings.foreground, settings.background);
}

export function applyQrColorTheme(settings, themeId) {
  const theme = getQrColorTheme(themeId);
  return theme
    ? {
      ...settings,
      colorTheme: theme.id,
      foreground: theme.foreground,
      background: theme.background,
    }
    : settings;
}

export function applyManualQrColor(settings, color, value) {
  return { ...settings, [color]: value, colorTheme: CUSTOM_QR_THEME_ID };
}

export function hasScannableQrContrast(foreground, background) {
  const luminance = (hex) => {
    const components = hex.match(/[\da-f]{2}/gi).map((part) => parseInt(part, 16) / 255);
    const [red, green, blue] = components.map((value) => (
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    ));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  return ratio >= 3;
}
