import assert from 'node:assert/strict';
import test from 'node:test';
import QRCode from 'qrcode';
import { buildQrContent, validateForm } from './qrContent.js';
import {
  addQrHistoryEntry,
  createQrHistoryEntry,
  getQrHistoryEntry,
  MAX_QR_HISTORY_ENTRIES,
  QR_HISTORY_STORAGE_KEY,
  readQrHistory,
  removeQrHistoryEntry,
  writeQrHistory,
} from './qrHistory.js';
import {
  applyLogoToSvg,
  applyLogoToPng,
  MAX_LOGO_FILE_SIZE,
  MAX_LOGO_SIZE_PERCENT,
  MIN_LOGO_SIZE_PERCENT,
  validateLogoFile,
} from './qrLogo.js';
import {
  applyManualQrColor,
  applyQrColorTheme,
  CUSTOM_QR_THEME_ID,
  hasScannableQrContrast,
  inferQrColorThemeId,
  QR_COLOR_THEMES,
} from './qrThemes.js';
import {
  createQrMatrix,
  createQrRenderPlan,
  drawQrPlanToCanvas,
  QR_STYLE_IDS,
  renderQrPlanToSvg,
} from './qrRenderer.js';

const blank = {
  text: '',
  website: '',
  video: '',
  email: '',
  subject: '',
  message: '',
  phone: '',
  ssid: '',
  security: 'WPA',
  password: '',
  hidden: false,
  fullName: '',
  organization: '',
  contactPhone: '',
  contactEmail: '',
  contactWebsite: '',
};

test('validates HTTP(S) links and rejects unsafe URL schemes and credentials', () => {
  assert.equal(validateForm('website', { ...blank, website: 'https://example.com/path' }).valid, true);
  for (const website of ['javascript:alert(1)', 'ftp://example.com', 'https://user:pass@example.com', 'https://bad host']) {
    assert.equal(validateForm('website', { ...blank, website }).valid, false, website);
  }
});

test('validates email and international phone input', () => {
  assert.equal(validateForm('email', { ...blank, email: 'alex.morgan@example.org' }).valid, true);
  assert.equal(validateForm('email', { ...blank, email: 'alex..morgan@example.org' }).valid, false);
  assert.equal(validateForm('phone', { ...blank, phone: '+1 (555) 123-4567' }).valid, true);
  assert.equal(validateForm('phone', { ...blank, phone: '12345abc678' }).valid, false);
});

test('builds escaped Wi-Fi payloads for secured and open networks', () => {
  const secured = { ...blank, ssid: 'Lab;Guest\\East', password: 'correct horse battery staple', hidden: true };
  assert.equal(
    buildQrContent('wifi', secured),
    'WIFI:T:WPA;S:Lab\\;Guest\\\\East;P:correct horse battery staple;H:true;;',
  );
  assert.equal(buildQrContent('wifi', { ...secured, security: 'nopass', password: '', hidden: false }), 'WIFI:T:nopass;S:Lab\\;Guest\\\\East;;');
  assert.equal(validateForm('wifi', { ...blank, ssid: 'Office', password: 'short' }).valid, false);
});

test('encodes contact details as an escaped vCard', () => {
  const contact = {
    ...blank,
    fullName: 'Alex; Morgan',
    organization: 'A,B Inc.',
    contactPhone: '+15551234567',
    contactEmail: 'alex@example.org',
    contactWebsite: 'https://example.org',
  };
  assert.equal(
    buildQrContent('contact', contact),
    'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alex\\; Morgan\r\nN:Alex\\; Morgan;;;\r\nORG:A\\,B Inc.\r\nTEL;TYPE=CELL:+15551234567\r\nEMAIL;TYPE=INTERNET:alex@example.org\r\nURL:https://example.org\r\nEND:VCARD',
  );
});

test('creates a mailto QR with correctly encoded optional content', () => {
  assert.equal(
    buildQrContent('email', { ...blank, email: 'alex@example.org', subject: 'Hello there', message: 'A & B' }),
    'mailto:alex@example.org?subject=Hello+there&body=A+%26+B',
  );
});

test('generates PNG and SVG exports with each theme and preserves the white logo backing', async () => {
  const options = {
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
  };
  for (const theme of QR_COLOR_THEMES) {
    const themeSettings = applyQrColorTheme({}, theme.id);
    const themeOptions = {
      ...options,
      color: { dark: themeSettings.foreground, light: themeSettings.background },
    };
    const png = await QRCode.toDataURL('Theme export', themeOptions);
    assert.match(png, /^data:image\/png;base64,/);

    const svg = await QRCode.toString('Theme export', { ...themeOptions, type: 'svg' });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /width="512" height="512"/);
    assert.ok(svg.toLowerCase().includes(`fill="${theme.background.toLowerCase()}"`));
    assert.ok(svg.toLowerCase().includes(`stroke="${theme.foreground.toLowerCase()}"`));
    assert.match(svg, /<\/svg>\s*$/);

    const logoSvg = applyLogoToSvg(svg, 'data:image/png;base64,AAAA', 20);
    assert.match(logoSvg, /<rect[^>]+fill="#ffffff"/);
    assert.match(logoSvg, /data:image\/png;base64,AAAA/);
  }
  await assert.rejects(QRCode.toDataURL('x'.repeat(10000)));
});

test('renders all QR styles from one protected matrix at representative payload lengths and sizes', () => {
  const cases = [
    { payload: 'QuickQR', size: 128 },
    { payload: `https://example.com/${'qr-style/'.repeat(20)}`, size: 320 },
    { payload: 'x'.repeat(900), size: 1024 },
  ];

  for (const { payload, size } of cases) {
    const matrix = createQrMatrix(payload, 'M');
    const baseData = [...matrix.modules.data];
    for (const style of QR_STYLE_IDS) {
      const plan = createQrRenderPlan(matrix, { size, margin: 2, style });
      assert.equal(plan.moduleSize, matrix.modules.size);
      assert.equal(plan.moduleCount, matrix.modules.size + 4);
      assert.ok(plan.outputSize >= size);
      assert.ok(plan.scale >= 2);
      assert.ok(plan.darkModules.every((module) => (
        module.x >= 2
        && module.y >= 2
        && module.x < matrix.modules.size + 2
        && module.y < matrix.modules.size + 2
      )));
      assert.ok(plan.darkModules.filter((module) => module.reserved)
        .every((module) => module.shape === 'square'));
      assert.deepEqual([...matrix.modules.data], baseData);

      const svg = renderQrPlanToSvg(plan, '#39FF14', '#071A12');
      assert.match(svg, new RegExp(`width="${plan.outputSize}" height="${plan.outputSize}"`));
      assert.match(svg, new RegExp(`viewBox="0 0 ${plan.moduleCount} ${plan.moduleCount}"`));
      assert.match(svg, /<rect width="\d+" height="\d+" fill="#071A12"\/>/);
      assert.equal((svg.match(/<circle /g) ?? []).length, plan.darkModules.filter(({ shape }) => shape === 'circle').length);
      assert.equal((svg.match(/<polygon /g) ?? []).length, plan.darkModules.filter(({ shape }) => shape === 'chamfered').length);
      assert.equal((svg.match(/<rect /g) ?? []).length, 1 + plan.darkModules.filter(({ shape }) => (
        shape === 'square' || shape === 'rounded'
      )).length);
    }
  }
});

test('preserves finder-pattern geometry and guards the reserved-module API', () => {
  const matrix = createQrMatrix('Finder pattern check', 'M');
  const size = matrix.modules.size;
  const origins = [[0, 0], [0, size - 7], [size - 7, 0]];

  for (const [top, left] of origins) {
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        const expectedDark = row === 0 || row === 6 || column === 0 || column === 6
          || (row >= 2 && row <= 4 && column >= 2 && column <= 4);
        const index = (top + row) * size + left + column;
        assert.equal(Boolean(matrix.modules.data[index]), expectedDark);
        assert.equal(Boolean(matrix.modules.isReserved(top + row, left + column)), true);
      }
    }
  }

  const matrixWithoutReservedMetadata = {
    modules: { ...matrix.modules, isReserved: undefined },
  };
  assert.throws(
    () => createQrRenderPlan(matrixWithoutReservedMetadata, { size: 320, style: 'dots' }),
    /cannot identify protected finder and function modules/,
  );
});

test('keeps canvas drawing operations consistent with SVG module geometry for every theme', () => {
  for (const theme of QR_COLOR_THEMES) {
    const matrix = createQrMatrix('Canvas and SVG style parity', 'H');
    for (const style of QR_STYLE_IDS) {
      const plan = createQrRenderPlan(matrix, { size: 512, margin: 2, style });
      const operations = { rectangles: [], circles: 0, lineSegments: 0, roundedSegments: 0 };
      const context = {
        fillStyle: '',
        fillRect(...args) { operations.rectangles.push(args); },
        save() {},
        scale() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        lineTo() { operations.lineSegments += 1; },
        quadraticCurveTo() { operations.roundedSegments += 1; },
        closePath() {},
        arc() { operations.circles += 1; },
        fill() {},
      };
      drawQrPlanToCanvas(context, plan, theme.foreground, theme.background);
      const svg = renderQrPlanToSvg(plan, theme.foreground, theme.background);
      const squareCount = plan.darkModules.filter(({ shape }) => shape === 'square').length;
      const roundedCount = plan.darkModules.filter(({ shape }) => shape === 'rounded').length;
      const circleCount = plan.darkModules.filter(({ shape }) => shape === 'circle').length;
      const chamferedCount = plan.darkModules.filter(({ shape }) => shape === 'chamfered').length;

      assert.equal(operations.rectangles.length, squareCount + 1);
      assert.equal(operations.roundedSegments, roundedCount * 4);
      assert.equal(operations.lineSegments, roundedCount * 4 + chamferedCount * 7);
      assert.equal(operations.circles, circleCount);
      assert.equal((svg.match(/<polygon /g) ?? []).length, chamferedCount);
      assert.ok(svg.includes(`fill="${theme.foreground}"`));
      assert.ok(svg.includes(`fill="${theme.background}"`));
    }
  }
});

test('applies the existing PNG logo composition to a custom-rendered image', async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  let drawCount = 0;
  let backingCount = 0;
  globalThis.Image = class {
    constructor() {
      this.naturalWidth = 128;
      this.naturalHeight = 128;
    }

    set src(value) {
      this.source = value;
      queueMicrotask(() => this.onload());
    }
  };
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() { drawCount += 1; },
            fillRect() { backingCount += 1; },
            set fillStyle(value) {},
          };
        },
        toDataURL() { return 'data:image/png;base64,COMPLETE'; },
      };
    },
  };

  try {
    const result = await applyLogoToPng(
      'data:image/png;base64,QR',
      'data:image/png;base64,LOGO',
      18,
    );
    assert.equal(result, 'data:image/png;base64,COMPLETE');
    assert.equal(drawCount, 2);
    assert.equal(backingCount, 1);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('selects all requested themes and marks manual colour changes as Custom', () => {
  assert.deepEqual(QR_COLOR_THEMES.map(({ name, foreground, background }) => (
    { name, foreground, background }
  )), [
    { name: 'Matrix', foreground: '#39FF14', background: '#071A12' },
    { name: 'Classic', foreground: '#111111', background: '#FFFFFF' },
    { name: 'Ocean', foreground: '#55C8FF', background: '#0B1B3A' },
    { name: 'Purple', foreground: '#D9A7FF', background: '#241038' },
    { name: 'Ruby', foreground: '#FFB0B8', background: '#3A1018' },
    { name: 'Emerald', foreground: '#A7FFE4', background: '#07352D' },
  ]);
  for (const theme of QR_COLOR_THEMES) {
    const selected = applyQrColorTheme({}, theme.id);
    assert.equal(selected.colorTheme, theme.id);
    assert.equal(selected.foreground, theme.foreground);
    assert.equal(selected.background, theme.background);
    assert.equal(hasScannableQrContrast(theme.foreground, theme.background), true);
  }

  const manuallyChanged = applyManualQrColor(
    applyQrColorTheme({}, 'matrix'),
    'foreground',
    '#111111',
  );
  const customMatchingPreset = applyManualQrColor(manuallyChanged, 'background', '#FFFFFF');
  assert.equal(customMatchingPreset.colorTheme, CUSTOM_QR_THEME_ID);
  assert.equal(inferQrColorThemeId(customMatchingPreset.foreground, customMatchingPreset.background), 'classic');
  assert.equal(hasScannableQrContrast('#666666', '#777777'), false);
});

test('validates supported logo image files, size limits, and percentage bounds', () => {
  assert.equal(validateLogoFile({ name: 'mark.webp', type: 'image/webp', size: 1024 }), '');
  assert.equal(validateLogoFile({ name: 'mark.jpg', type: 'image/jpeg', size: 1024 }), '');
  assert.match(validateLogoFile({ name: 'mark.gif', type: 'image/gif', size: 1024 }), /PNG, JPG, JPEG, or WEBP/);
  assert.match(
    validateLogoFile({ name: 'mark.png', type: 'image/png', size: MAX_LOGO_FILE_SIZE + 1 }),
    /smaller than 2 MB/,
  );
  assert.equal(MIN_LOGO_SIZE_PERCENT, 12);
  assert.equal(MAX_LOGO_SIZE_PERCENT, 24);
});

test('embeds a centered logo and white padding in a valid SVG', async () => {
  const logo = 'data:image/png;base64,AAAA';
  const qrSvg = await QRCode.toString('Logo QR', { type: 'svg', width: 512, errorCorrectionLevel: 'H' });
  const svgWithLogo = applyLogoToSvg(qrSvg, logo, 20);
  assert.match(svgWithLogo, /data-quickqr-logo="true"/);
  assert.match(svgWithLogo, /<rect[^>]+fill="#ffffff"/);
  assert.match(svgWithLogo, /<image[^>]+href="data:image\/png;base64,AAAA"/);
  assert.match(svgWithLogo, /<\/svg>\s*$/);
  assert.throws(() => applyLogoToSvg(qrSvg, 'data:image/svg+xml;base64,AAAA', 20), /logo image is invalid/);
});

function memoryStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem(key) {
      assert.equal(key, QR_HISTORY_STORAGE_KEY);
      return value;
    },
    setItem(key, nextValue) {
      assert.equal(key, QR_HISTORY_STORAGE_KEY);
      value = nextValue;
    },
  };
}

function sampleHistoryEntry(id, overrides = {}) {
  return {
    id,
    type: 'text',
    values: { ...blank, text: `QR ${id}` },
    payload: `QR ${id}`,
    settings: { size: 320, foreground: '#07130b', background: '#ffffff' },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('stores, reloads, restores, deletes, and clears QR history', () => {
  const storage = memoryStorage();
  const first = sampleHistoryEntry('first', {
    settings: {
      size: 512,
      foreground: '#123456',
      background: '#fedcba',
      logoDataUrl: 'data:image/webp;base64,AAAA',
      logoEnabled: true,
      logoSize: 22,
    },
  });
  const second = sampleHistoryEntry('second', { type: 'website' });

  assert.equal(writeQrHistory([second, first], storage), true);
  const reloaded = readQrHistory(storage);
  assert.equal(reloaded.error, false);
  assert.deepEqual(reloaded.entries, [second, first]);
  assert.deepEqual(getQrHistoryEntry(reloaded.entries, 'first'), {
    ...first,
    settings: { ...first.settings, colorTheme: 'custom', qrStyle: 'square' },
  });

  const afterDelete = removeQrHistoryEntry(reloaded.entries, 'second');
  assert.deepEqual(afterDelete, [first]);
  assert.equal(writeQrHistory(afterDelete, storage), true);
  assert.deepEqual(readQrHistory(storage).entries, [first]);

  assert.equal(writeQrHistory([], storage), true);
  assert.deepEqual(readQrHistory(storage).entries, []);
});

test('saves and restores selected themes and custom colours in QR history', () => {
  const storage = memoryStorage();
  const oceanSettings = applyQrColorTheme({ size: 320 }, 'ocean');
  const customSettings = applyManualQrColor(oceanSettings, 'foreground', '#44CCAA');
  const entry = createQrHistoryEntry({
    type: 'text',
    values: { ...blank, text: 'Theme history' },
    payload: 'Theme history',
    settings: customSettings,
  });
  const presetEntry = createQrHistoryEntry({
    type: 'text',
    values: { ...blank, text: 'Preset history' },
    payload: 'Preset history',
    settings: oceanSettings,
  });
  assert.equal(writeQrHistory([entry, presetEntry], storage), true);
  const storedEntries = readQrHistory(storage).entries;
  const restored = getQrHistoryEntry(storedEntries, entry.id);
  assert.equal(restored.settings.colorTheme, CUSTOM_QR_THEME_ID);
  assert.equal(restored.settings.foreground, '#44CCAA');
  assert.equal(restored.settings.background, oceanSettings.background);
  assert.equal(getQrHistoryEntry(storedEntries, presetEntry.id).settings.colorTheme, 'ocean');

  const legacyEntry = sampleHistoryEntry('legacy', {
    settings: { size: 320, foreground: '#55C8FF', background: '#0B1B3A' },
  });
  assert.equal(getQrHistoryEntry([legacyEntry], 'legacy').settings.colorTheme, 'ocean');
});

test('saves, validates, restores QR styles, and defaults legacy entries to Square', () => {
  const storage = memoryStorage();
  const rounded = createQrHistoryEntry({
    type: 'text',
    values: { ...blank, text: 'Rounded QR' },
    payload: 'Rounded QR',
    settings: { size: 320, foreground: '#39FF14', background: '#071A12', qrStyle: 'rounded' },
  });
  assert.equal(writeQrHistory([rounded], storage), true);
  assert.equal(getQrHistoryEntry(readQrHistory(storage).entries, rounded.id).settings.qrStyle, 'rounded');

  const legacyEntry = sampleHistoryEntry('legacy-style');
  assert.equal(getQrHistoryEntry([legacyEntry], 'legacy-style').settings.qrStyle, 'square');

  const unsupportedStyle = sampleHistoryEntry('unsupported-style', {
    settings: { size: 320, foreground: '#07130b', background: '#ffffff', qrStyle: 'sparkles' },
  });
  assert.deepEqual(readQrHistory(memoryStorage(JSON.stringify({
    version: 1,
    entries: [unsupportedStyle],
  }))), { entries: [], error: true });
});

test('keeps only the latest 20 entries and excludes Wi-Fi entries and credentials', () => {
  const entries = Array.from({ length: MAX_QR_HISTORY_ENTRIES + 2 }, (_, index) => sampleHistoryEntry(String(index)));
  const limited = entries.reduce((current, entry) => addQrHistoryEntry(current, entry), []);
  assert.equal(limited.length, MAX_QR_HISTORY_ENTRIES);
  assert.equal(limited[0].id, '21');
  assert.equal(limited.at(-1).id, '2');

  assert.equal(createQrHistoryEntry({
    type: 'wifi',
    values: { ...blank, ssid: 'Private network', password: 'secret-password' },
    payload: 'WIFI:T:WPA;S:Private network;P:secret-password;;',
    settings: { size: 320, foreground: '#07130b', background: '#ffffff' },
  }), null);

  const entry = createQrHistoryEntry({
    type: 'text',
    values: { ...blank, text: 'Public text', ssid: 'Private network', password: 'secret-password', hidden: true },
    payload: 'Public text',
    settings: { size: 320, foreground: '#07130b', background: '#ffffff' },
  });
  assert.equal(entry.values.password, '');
  assert.equal(entry.values.ssid, '');
  assert.equal(entry.values.hidden, false);
});

test('handles malformed and unavailable localStorage without throwing', () => {
  assert.deepEqual(readQrHistory(memoryStorage('{broken')), { entries: [], error: true });
  assert.deepEqual(readQrHistory({
    getItem() { throw new Error('storage unavailable'); },
  }), { entries: [], error: true });
  assert.equal(writeQrHistory([], {
    setItem() { throw new Error('storage unavailable'); },
  }), false);
});
