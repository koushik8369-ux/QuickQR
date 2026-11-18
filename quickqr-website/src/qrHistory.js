import {
  getQrColorThemeId,
  isQrColorThemeCompatible,
} from './qrThemes.js';
import {
  MAX_QR_QUIET_ZONE_MODULES,
  MIN_QR_QUIET_ZONE_MODULES,
  QR_STYLE_IDS,
} from './qrRenderer.js';
import {
  DEFAULT_LOGO_PADDING_PERCENT,
  DEFAULT_LOGO_POSITION,
  DEFAULT_LOGO_SIZE_PERCENT,
  LOGO_POSITION_IDS,
  MAX_LOGO_PADDING_PERCENT,
  MIN_LOGO_PADDING_PERCENT,
  MAX_LOGO_SIZE_PERCENT,
  MIN_LOGO_SIZE_PERCENT,
} from './qrLogo.js';

export const QR_HISTORY_STORAGE_KEY = 'quickqr_history_v1';
export const MAX_QR_HISTORY_ENTRIES = 20;

const QR_TYPES = new Set(['text', 'website', 'video', 'email', 'phone', 'contact']);
const QR_SIZES = new Set([128, 256, 320, 512, 1024]);
const COLOR_PATTERN = /^#[\da-f]{6}$/i;
const LOGO_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[\da-z+/]+=*$/i;

function isHistoryEntry(entry) {
  return Boolean(
    entry
    && typeof entry.id === 'string'
    && entry.id
    && QR_TYPES.has(entry.type)
    && entry.values
    && typeof entry.values === 'object'
    && !Array.isArray(entry.values)
    && !entry.values.ssid
    && !entry.values.password
    && entry.values.hidden !== true
    && typeof entry.payload === 'string'
    && entry.settings
    && QR_SIZES.has(entry.settings.size)
    && COLOR_PATTERN.test(entry.settings.foreground)
    && COLOR_PATTERN.test(entry.settings.background)
    && isQrColorThemeCompatible(
      entry.settings.colorTheme,
      entry.settings.foreground,
      entry.settings.background,
    )
    && (entry.settings.logoDataUrl === undefined
      || entry.settings.logoDataUrl === ''
      || LOGO_DATA_URL_PATTERN.test(entry.settings.logoDataUrl))
    && (entry.settings.logoEnabled === undefined || typeof entry.settings.logoEnabled === 'boolean')
    && (entry.settings.logoSize === undefined
      || (
        Number.isInteger(entry.settings.logoSize)
        && entry.settings.logoSize >= MIN_LOGO_SIZE_PERCENT
        && entry.settings.logoSize <= MAX_LOGO_SIZE_PERCENT
      ))
    && (entry.settings.logoPosition === undefined || LOGO_POSITION_IDS.includes(entry.settings.logoPosition))
    && (entry.settings.logoPadding === undefined
      || (
        Number.isInteger(entry.settings.logoPadding)
        && entry.settings.logoPadding >= MIN_LOGO_PADDING_PERCENT
        && entry.settings.logoPadding <= MAX_LOGO_PADDING_PERCENT
      ))
    && (entry.settings.qrStyle === undefined || QR_STYLE_IDS.includes(entry.settings.qrStyle))
    && (entry.settings.transparentBackground === undefined
      || typeof entry.settings.transparentBackground === 'boolean')
    && (entry.settings.quietZone === undefined
      || (
        Number.isInteger(entry.settings.quietZone)
        && entry.settings.quietZone >= MIN_QR_QUIET_ZONE_MODULES
        && entry.settings.quietZone <= MAX_QR_QUIET_ZONE_MODULES
      ))
    && typeof entry.createdAt === 'string'
    && Number.isFinite(Date.parse(entry.createdAt)),
  );
}

function getStorage(storage) {
  return storage ?? window.localStorage;
}

export function readQrHistory(storage) {
  try {
    const serialized = getStorage(storage).getItem(QR_HISTORY_STORAGE_KEY);
    if (serialized === null) return { entries: [], error: false };

    const stored = JSON.parse(serialized);
    if (stored?.version !== 1 || !Array.isArray(stored.entries)) {
      return { entries: [], error: true };
    }

    const entries = stored.entries.filter(isHistoryEntry).slice(0, MAX_QR_HISTORY_ENTRIES);
    return { entries, error: entries.length !== stored.entries.length };
  } catch {
    return { entries: [], error: true };
  }
}

export function writeQrHistory(entries, storage) {
  try {
    getStorage(storage).setItem(QR_HISTORY_STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: entries.slice(0, MAX_QR_HISTORY_ENTRIES),
    }));
    return true;
  } catch {
    return false;
  }
}

export function createQrHistoryEntry({ type, values, payload, settings }) {
  if (!QR_TYPES.has(type)) return null;

  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return {
    id,
    type,
    values: {
      ...values,
      ssid: '',
      security: 'WPA',
      password: '',
      hidden: false,
    },
    payload,
    settings: { ...settings },
    createdAt: new Date().toISOString(),
  };
}

export function addQrHistoryEntry(entries, entry) {
  return [entry, ...entries.filter((existing) => existing.id !== entry.id)]
    .slice(0, MAX_QR_HISTORY_ENTRIES);
}

export function getQrHistoryEntry(entries, id) {
  const entry = entries.find((candidate) => candidate.id === id);
  return entry ? {
    ...entry,
    values: { ...entry.values },
    settings: {
      ...entry.settings,
      colorTheme: getQrColorThemeId(entry.settings),
      qrStyle: entry.settings.qrStyle ?? 'square',
      transparentBackground: entry.settings.transparentBackground ?? false,
      quietZone: entry.settings.quietZone ?? MIN_QR_QUIET_ZONE_MODULES,
      logoSize: entry.settings.logoSize ?? DEFAULT_LOGO_SIZE_PERCENT,
      logoPosition: entry.settings.logoPosition ?? DEFAULT_LOGO_POSITION,
      logoPadding: entry.settings.logoPadding ?? DEFAULT_LOGO_PADDING_PERCENT,
    },
  } : null;
}

export function removeQrHistoryEntry(entries, id) {
  return entries.filter((entry) => entry.id !== id);
}
