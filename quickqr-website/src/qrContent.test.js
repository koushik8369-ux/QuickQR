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
  DEFAULT_LOGO_PADDING_PERCENT,
  DEFAULT_LOGO_POSITION,
  DEFAULT_LOGO_SIZE_PERCENT,
  LOGO_POSITION_OPTIONS,
  LogoFinderOverlapError,
  MAX_LOGO_PADDING_PERCENT,
  applyLogoToSvg,
  applyLogoToPng,
  createLogoGeometry,
  MAX_LOGO_FILE_SIZE,
  MAX_LOGO_SIZE_PERCENT,
  MIN_LOGO_PADDING_PERCENT,
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
  getQrErrorCorrectionLevel,
  MAX_QR_QUIET_ZONE_MODULES,
  MIN_QR_QUIET_ZONE_MODULES,
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

    const logoPlan = createQrRenderPlan(createQrMatrix('Theme export', 'H'), { size: 512, margin: 2 });
    const logoGeometry = createLogoGeometry(logoPlan, { logoSize: 20 });
    const customSvg = renderQrPlanToSvg(logoPlan, theme.foreground, theme.background);
    const logoSvg = applyLogoToSvg(customSvg, 'data:image/png;base64,AAAA', logoGeometry);
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

test('validates quiet-zone bounds and includes the selected margin in render geometry', () => {
  const matrix = createQrMatrix('Quiet zone geometry', 'M');
  for (const quietZone of [MIN_QR_QUIET_ZONE_MODULES, 5, MAX_QR_QUIET_ZONE_MODULES]) {
    const plan = createQrRenderPlan(matrix, { size: 320, margin: quietZone });
    assert.equal(plan.margin, quietZone);
    assert.equal(plan.moduleCount, matrix.modules.size + quietZone * 2);
    assert.ok(plan.darkModules.every(({ x, y }) => (
      x >= quietZone
      && y >= quietZone
      && x < matrix.modules.size + quietZone
      && y < matrix.modules.size + quietZone
    )));
  }

  for (const quietZone of [MIN_QR_QUIET_ZONE_MODULES - 1, MAX_QR_QUIET_ZONE_MODULES + 1, 2.5]) {
    assert.throws(
      () => createQrRenderPlan(matrix, { size: 320, margin: quietZone }),
      /quiet zone must be an integer/,
    );
  }
});

test('keeps canvas drawing operations consistent with SVG module geometry for every theme', () => {
  for (const theme of QR_COLOR_THEMES) {
    const matrix = createQrMatrix('Canvas and SVG style parity', 'H');
    for (const style of QR_STYLE_IDS) {
      const plan = createQrRenderPlan(matrix, { size: 512, margin: 2, style });
      const createOperations = () => ({
        rectangles: [],
        circles: 0,
        lineSegments: 0,
        roundedSegments: 0,
      });
      const createContext = (operations) => ({
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
      });
      const opaqueOperations = createOperations();
      const transparentOperations = createOperations();
      drawQrPlanToCanvas(createContext(opaqueOperations), plan, theme.foreground, theme.background);
      drawQrPlanToCanvas(
        createContext(transparentOperations),
        plan,
        theme.foreground,
        theme.background,
        { transparentBackground: true },
      );
      const svg = renderQrPlanToSvg(plan, theme.foreground, theme.background);
      const transparentSvg = renderQrPlanToSvg(
        plan,
        theme.foreground,
        theme.background,
        { transparentBackground: true },
      );
      const squareCount = plan.darkModules.filter(({ shape }) => shape === 'square').length;
      const roundedCount = plan.darkModules.filter(({ shape }) => shape === 'rounded').length;
      const circleCount = plan.darkModules.filter(({ shape }) => shape === 'circle').length;
      const chamferedCount = plan.darkModules.filter(({ shape }) => shape === 'chamfered').length;

      assert.equal(opaqueOperations.rectangles.length, squareCount + 1);
      assert.equal(transparentOperations.rectangles.length, squareCount);
      assert.equal(opaqueOperations.roundedSegments, roundedCount * 4);
      assert.equal(transparentOperations.roundedSegments, roundedCount * 4);
      assert.equal(opaqueOperations.lineSegments, roundedCount * 4 + chamferedCount * 7);
      assert.equal(transparentOperations.lineSegments, roundedCount * 4 + chamferedCount * 7);
      assert.equal(opaqueOperations.circles, circleCount);
      assert.equal(transparentOperations.circles, circleCount);
      assert.equal((svg.match(/<polygon /g) ?? []).length, chamferedCount);
      assert.equal((transparentSvg.match(/<polygon /g) ?? []).length, chamferedCount);
      assert.ok(svg.includes(`fill="${theme.foreground}"`));
      assert.ok(svg.includes(`fill="${theme.background}"`));
      assert.ok(svg.includes(`<rect width="${plan.moduleCount}" height="${plan.moduleCount}" fill="${theme.background}"/>`));
      assert.ok(!transparentSvg.includes(`<rect width="${plan.moduleCount}" height="${plan.moduleCount}" fill="${theme.background}"/>`));
    }
  }
});

test('rejects invalid transparent-background renderer options', () => {
  const plan = createQrRenderPlan(createQrMatrix('Invalid transparency', 'M'), { size: 320 });
  const context = {
    fillRect() {},
    save() {},
    scale() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    arc() {},
    fill() {},
  };
  assert.throws(
    () => drawQrPlanToCanvas(context, plan, '#111111', '#ffffff', { transparentBackground: 'yes' }),
    /must be a boolean/,
  );
  assert.throws(
    () => renderQrPlanToSvg(plan, '#111111', '#ffffff', { transparentBackground: 1 }),
    /must be a boolean/,
  );
});

test('applies the existing PNG logo composition to a custom-rendered image', async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const drawCalls = [];
  const backingCalls = [];
  const plan = createQrRenderPlan(createQrMatrix('Logo PNG placement', 'H'), { size: 512, margin: 2 });
  globalThis.Image = class {
    set src(value) {
      this.source = value;
      this.naturalWidth = value === 'data:image/png;base64,QR' ? plan.outputSize : 128;
      this.naturalHeight = this.naturalWidth;
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
            fillStyle: '',
            drawImage(...args) { drawCalls.push(args); },
            fillRect() {
              assert.equal(this.fillStyle, '#ffffff');
              backingCalls.push([...arguments]);
            },
          };
        },
        toDataURL() { return 'data:image/png;base64,COMPLETE'; },
      };
    },
  };

  try {
    for (const { id: logoPosition } of LOGO_POSITION_OPTIONS) {
      const geometry = createLogoGeometry(plan, {
        logoPosition,
        logoSize: DEFAULT_LOGO_SIZE_PERCENT,
        logoPadding: DEFAULT_LOGO_PADDING_PERCENT,
      });
      const result = await applyLogoToPng(
        'data:image/png;base64,QR',
        'data:image/png;base64,LOGO',
        geometry,
      );
      assert.equal(result, 'data:image/png;base64,COMPLETE');
      assert.deepEqual(backingCalls[backingCalls.length - 1], [
        geometry.backing.x * geometry.scale,
        geometry.backing.y * geometry.scale,
        geometry.backing.size * geometry.scale,
        geometry.backing.size * geometry.scale,
      ]);
      assert.deepEqual(drawCalls[drawCalls.length - 1].slice(1), [
        geometry.logo.x * geometry.scale,
        geometry.logo.y * geometry.scale,
        geometry.logo.size * geometry.scale,
        geometry.logo.size * geometry.scale,
      ]);
    }
    assert.equal(drawCalls.length, LOGO_POSITION_OPTIONS.length * 2);
    assert.equal(backingCalls.length, LOGO_POSITION_OPTIONS.length);
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
    const selected = applyQrColorTheme({ transparentBackground: true }, theme.id);
    assert.equal(selected.colorTheme, theme.id);
    assert.equal(selected.foreground, theme.foreground);
    assert.equal(selected.background, theme.background);
    assert.equal(selected.transparentBackground, false);
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
  assert.equal(MIN_LOGO_PADDING_PERCENT, 8);
  assert.equal(MAX_LOGO_PADDING_PERCENT, 32);
});

test('embeds a centered logo and white padding in a valid SVG', async () => {
  const logo = 'data:image/png;base64,AAAA';
  const qrSvg = await QRCode.toString('Logo QR', { type: 'svg', width: 512, errorCorrectionLevel: 'H' });
  const plan = createQrRenderPlan(createQrMatrix('Logo QR', 'H'), { size: 512 });
  const geometry = createLogoGeometry(plan, { logoSize: 20 });
  const rendererSvg = renderQrPlanToSvg(plan, '#111111', '#ffffff');
  const svgWithLogo = applyLogoToSvg(rendererSvg, logo, geometry);
  assert.match(svgWithLogo, /data-quickqr-logo="true"/);
  assert.match(svgWithLogo, /<rect[^>]+fill="#ffffff"/);
  assert.match(svgWithLogo, /<image[^>]+href="data:image\/png;base64,AAAA"/);
  assert.match(svgWithLogo, /<\/svg>\s*$/);
  assert.throws(
    () => applyLogoToSvg(rendererSvg, 'data:image/svg+xml;base64,AAAA', geometry),
    /logo image is invalid/,
  );
  assert.throws(() => applyLogoToSvg(qrSvg, logo, geometry), /dimensions do not match/);

  for (const transparentBackground of [false, true]) {
    const qrMarkup = renderQrPlanToSvg(plan, '#111111', '#ffffff', { transparentBackground });
    const markupWithLogo = applyLogoToSvg(qrMarkup, logo, geometry);
    assert.match(markupWithLogo, /<rect[^>]+fill="#ffffff"/);
    assert.match(markupWithLogo, /data-quickqr-logo="true"/);
    assert.equal(
      qrMarkup.includes(`<rect width="${plan.moduleCount}" height="${plan.moduleCount}" fill="#ffffff"/>`),
      !transparentBackground,
    );
  }
});

test('positions logos across every style, theme, and background mode with matching PNG/SVG geometry', async () => {
  const matrix = createQrMatrix('Advanced logo positioning '.repeat(16), 'H');
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const canvasCaptures = [];
  let qrImageSize = 0;
  globalThis.Image = class {
    set src(value) {
      this.naturalWidth = value === 'data:image/png;base64,LOGO' ? 128 : qrImageSize;
      this.naturalHeight = value === 'data:image/png;base64,LOGO' ? 64 : qrImageSize;
      queueMicrotask(() => this.onload());
    }
  };
  globalThis.document = {
    createElement() {
      const capture = { drawCalls: [], backing: null };
      canvasCaptures.push(capture);
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            _fillStyle: '',
            get fillStyle() { return this._fillStyle; },
            set fillStyle(value) { this._fillStyle = value; },
            drawImage(...args) { capture.drawCalls.push(args.slice(1)); },
            fillRect(...args) {
              capture.backing = { fillStyle: this.fillStyle, args };
            },
          };
        },
        toDataURL() { return 'data:image/png;base64,COMPOSITED'; },
      };
    },
  };

  try {
    for (const style of QR_STYLE_IDS) {
      const plan = createQrRenderPlan(matrix, { size: 512, margin: 2, style });
      qrImageSize = plan.outputSize;
      for (const theme of QR_COLOR_THEMES) {
        for (const transparentBackground of [false, true]) {
          const svg = renderQrPlanToSvg(
            plan,
            theme.foreground,
            theme.background,
            { transparentBackground },
          );
          assert.equal(
            svg.includes(`<rect width="${plan.moduleCount}" height="${plan.moduleCount}" fill="${theme.background}"/>`),
            !transparentBackground,
          );
          for (const { id: logoPosition } of LOGO_POSITION_OPTIONS) {
            const geometry = createLogoGeometry(plan, {
              logoPosition,
              logoSize: DEFAULT_LOGO_SIZE_PERCENT,
              logoPadding: DEFAULT_LOGO_PADDING_PERCENT,
            });
            const svgWithLogo = applyLogoToSvg(svg, 'data:image/png;base64,AAAA', geometry);
            assert.ok(svgWithLogo.includes(
              `<rect x="${geometry.backing.x}" y="${geometry.backing.y}" width="${geometry.backing.size}" height="${geometry.backing.size}" fill="#ffffff"/>`,
            ));
            assert.ok(svgWithLogo.includes(
              `<image x="${geometry.logo.x}" y="${geometry.logo.y}" width="${geometry.logo.size}" height="${geometry.logo.size}"`,
            ));
            const qrDataUrl = transparentBackground
              ? 'data:image/png;base64,TRANSPARENT_QR'
              : 'data:image/png;base64,OPAQUE_QR';
            assert.equal(
              await applyLogoToPng(qrDataUrl, 'data:image/png;base64,LOGO', geometry),
              'data:image/png;base64,COMPOSITED',
            );
            const capture = canvasCaptures[canvasCaptures.length - 1];
            assert.equal(capture.backing.fillStyle, '#ffffff');
            assert.deepEqual(capture.backing.args, [
              geometry.backing.x * geometry.scale,
              geometry.backing.y * geometry.scale,
              geometry.backing.size * geometry.scale,
              geometry.backing.size * geometry.scale,
            ]);
            const logoBoxPixels = geometry.logo.size * geometry.scale;
            const imageScale = Math.min(logoBoxPixels / 128, logoBoxPixels / 64);
            const logoWidth = 128 * imageScale;
            const logoHeight = 64 * imageScale;
            assert.deepEqual(capture.drawCalls[1], [
              geometry.logo.x * geometry.scale + (logoBoxPixels - logoWidth) / 2,
              geometry.logo.y * geometry.scale + (logoBoxPixels - logoHeight) / 2,
              logoWidth,
              logoHeight,
            ]);
            assert.ok(Math.abs(
              geometry.backing.size - geometry.logo.size - geometry.logo.size * (geometry.logoPadding / 50),
            ) < 0.000001);
          }
        }
      }
    }
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('rejects logo backing that intersects QR finder patterns', () => {
  const plan = createQrRenderPlan(createQrMatrix('QuickQR', 'H'), { size: 320, margin: 2 });
  for (const { id: logoPosition } of LOGO_POSITION_OPTIONS) {
    assert.throws(
      () => createLogoGeometry(plan, {
        logoPosition,
        logoSize: MAX_LOGO_SIZE_PERCENT,
        logoPadding: MAX_LOGO_PADDING_PERCENT,
      }),
      LogoFinderOverlapError,
    );
  }
});

test('validates logo settings and keeps high error correction when a logo is enabled', () => {
  const plan = createQrRenderPlan(createQrMatrix('Logo settings validation', 'H'), { size: 512 });
  for (const settings of [
    { logoPosition: null },
    { logoPosition: 'middle' },
    { logoSize: MIN_LOGO_SIZE_PERCENT - 1 },
    { logoSize: MAX_LOGO_SIZE_PERCENT + 1 },
    { logoSize: null },
    { logoSize: 18.5 },
    { logoPadding: MIN_LOGO_PADDING_PERCENT - 1 },
    { logoPadding: MAX_LOGO_PADDING_PERCENT + 1 },
    { logoPadding: null },
    { logoPadding: 16.5 },
  ]) {
    assert.throws(() => createLogoGeometry(plan, settings));
  }

  assert.equal(getQrErrorCorrectionLevel(true, true), 'H');
  assert.equal(getQrErrorCorrectionLevel(false, true), 'M');
  assert.equal(getQrErrorCorrectionLevel(true, false), 'M');
  assert.throws(() => getQrErrorCorrectionLevel('true', true), /boolean/);
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
    settings: {
      ...first.settings,
      colorTheme: 'custom',
      qrStyle: 'square',
      transparentBackground: false,
      quietZone: MIN_QR_QUIET_ZONE_MODULES,
      logoPosition: DEFAULT_LOGO_POSITION,
      logoPadding: DEFAULT_LOGO_PADDING_PERCENT,
    },
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

test('saves and restores background settings while defaulting legacy history entries', () => {
  const storage = memoryStorage();
  const customized = createQrHistoryEntry({
    type: 'text',
    values: { ...blank, text: 'Transparent history' },
    payload: 'Transparent history',
    settings: {
      size: 512,
      foreground: '#39FF14',
      background: '#071A12',
      transparentBackground: true,
      quietZone: 7,
    },
  });
  assert.equal(writeQrHistory([customized], storage), true);
  const restored = getQrHistoryEntry(readQrHistory(storage).entries, customized.id);
  assert.equal(restored.settings.transparentBackground, true);
  assert.equal(restored.settings.quietZone, 7);

  const legacy = sampleHistoryEntry('legacy-background');
  const legacyRestored = getQrHistoryEntry([legacy], legacy.id);
  assert.equal(legacyRestored.settings.transparentBackground, false);
  assert.equal(legacyRestored.settings.quietZone, MIN_QR_QUIET_ZONE_MODULES);
  assert.equal(legacyRestored.settings.logoPosition, DEFAULT_LOGO_POSITION);
  assert.equal(legacyRestored.settings.logoSize, DEFAULT_LOGO_SIZE_PERCENT);
  assert.equal(legacyRestored.settings.logoPadding, DEFAULT_LOGO_PADDING_PERCENT);

  for (const settings of [
    { transparentBackground: 'true' },
    { quietZone: MIN_QR_QUIET_ZONE_MODULES - 1 },
    { quietZone: MAX_QR_QUIET_ZONE_MODULES + 1 },
    { quietZone: 2.5 },
  ]) {
    const invalidEntry = sampleHistoryEntry(`invalid-${Object.keys(settings)[0]}`, {
      settings: {
        size: 320,
        foreground: '#07130b',
        background: '#ffffff',
        ...settings,
      },
    });
    assert.deepEqual(readQrHistory(memoryStorage(JSON.stringify({
      version: 1,
      entries: [invalidEntry],
    }))), { entries: [], error: true });
  }
});

test('saves and validates logo position and backing padding in history', () => {
  const storage = memoryStorage();
  const entry = createQrHistoryEntry({
    type: 'text',
    values: { ...blank, text: 'Positioned logo history' },
    payload: 'Positioned logo history',
    settings: {
      size: 512,
      foreground: '#39FF14',
      background: '#071A12',
      logoEnabled: true,
      logoDataUrl: 'data:image/png;base64,AAAA',
      logoSize: 22,
      logoPosition: 'bottom',
      logoPadding: 28,
    },
  });
  assert.equal(writeQrHistory([entry], storage), true);
  const restored = getQrHistoryEntry(readQrHistory(storage).entries, entry.id);
  assert.equal(restored.settings.logoSize, 22);
  assert.equal(restored.settings.logoPosition, 'bottom');
  assert.equal(restored.settings.logoPadding, 28);

  for (const settings of [
    { logoPosition: null },
    { logoPosition: 'left' },
    { logoSize: MIN_LOGO_SIZE_PERCENT - 1 },
    { logoSize: MAX_LOGO_SIZE_PERCENT + 1 },
    { logoSize: null },
    { logoPadding: MIN_LOGO_PADDING_PERCENT - 1 },
    { logoPadding: MAX_LOGO_PADDING_PERCENT + 1 },
    { logoPadding: null },
    { logoPadding: 16.5 },
  ]) {
    const invalidEntry = sampleHistoryEntry(`invalid-logo-${Object.keys(settings)[0]}`, {
      settings: {
        size: 320,
        foreground: '#07130b',
        background: '#ffffff',
        ...settings,
      },
    });
    assert.deepEqual(readQrHistory(memoryStorage(JSON.stringify({
      version: 1,
      entries: [invalidEntry],
    }))), { entries: [], error: true });
  }
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
