import QRCode from 'qrcode';

export const QR_STYLE_OPTIONS = [
  { id: 'square', label: 'Square', description: 'Classic, crisp modules' },
  { id: 'rounded', label: 'Rounded', description: 'Soft, rounded corners' },
  { id: 'dots', label: 'Dots', description: 'Compact circular modules' },
  { id: 'modern', label: 'Modern', description: 'Geometric chamfered modules' },
];

export const QR_STYLE_IDS = QR_STYLE_OPTIONS.map(({ id }) => id);

const QR_STYLE_GEOMETRY = {
  square: { shape: 'square', inset: 0 },
  rounded: { shape: 'rounded', inset: 0.06, radius: 0.22 },
  dots: { shape: 'circle', radius: 0.41 },
  modern: { shape: 'chamfered', inset: 0.025, cut: 0.13 },
};

const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;

export function createQrRenderPlan(qrCode, { size, margin = 2, style = 'square' }) {
  if (!QR_STYLE_IDS.includes(style)) throw new Error('Choose a supported QR style.');
  if (!Number.isInteger(size) || size < 1) throw new Error('QR size must be a positive integer.');
  if (!Number.isInteger(margin) || margin < 0) throw new Error('QR margin must be a non-negative integer.');

  const modules = qrCode?.modules;
  if (
    !modules
    || !Number.isInteger(modules.size)
    || modules.size < 1
    || !modules.data
    || modules.data.length !== modules.size * modules.size
  ) {
    throw new Error('The QR matrix is invalid.');
  }
  // qrcode@1.5.4 does not document isReserved; fail closed if its matrix API changes.
  if (typeof modules.isReserved !== 'function') {
    throw new Error('This QR matrix cannot identify protected finder and function modules.');
  }

  const moduleCount = modules.size + margin * 2;
  const requestedScale = size / moduleCount;
  const scale = requestedScale < 1
    ? 4
    : Math.max(2, requestedScale);
  const outputSize = Math.ceil(moduleCount * scale);
  const geometry = QR_STYLE_GEOMETRY[style];
  const darkModules = [];
  let reservedModuleCount = 0;

  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      const index = row * modules.size + column;
      const reserved = modules.isReserved(row, column);
      if (reserved) reservedModuleCount += 1;
      if (!modules.data[index]) continue;

      darkModules.push({
        x: column + margin,
        y: row + margin,
        reserved,
        ...((reserved || style === 'square') ? { shape: 'square', inset: 0 } : geometry),
      });
    }
  }

  return {
    style,
    margin,
    moduleSize: modules.size,
    moduleCount,
    outputSize,
    scale: outputSize / moduleCount,
    reservedModuleCount,
    darkModules,
  };
}

function assertHexColor(color) {
  if (!HEX_COLOR_PATTERN.test(color)) throw new Error('QR colours must be six-digit hexadecimal values.');
}

function drawRoundedModule(context, module) {
  const x = module.x + module.inset;
  const y = module.y + module.inset;
  const width = 1 - module.inset * 2;
  const radius = Math.min(module.radius, width / 2);

  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + width - radius);
  context.quadraticCurveTo(x + width, y + width, x + width - radius, y + width);
  context.lineTo(x + radius, y + width);
  context.quadraticCurveTo(x, y + width, x, y + width - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.fill();
}

function drawChamferedModule(context, module) {
  const x = module.x + module.inset;
  const y = module.y + module.inset;
  const end = 1 - module.inset;
  const cut = module.cut;

  context.beginPath();
  context.moveTo(x + cut, y);
  context.lineTo(end - cut, y);
  context.lineTo(end, y + cut);
  context.lineTo(end, end - cut);
  context.lineTo(end - cut, end);
  context.lineTo(x + cut, end);
  context.lineTo(x, end - cut);
  context.lineTo(x, y + cut);
  context.closePath();
  context.fill();
}

export function drawQrPlanToCanvas(context, plan, foreground, background) {
  assertHexColor(foreground);
  assertHexColor(background);
  context.fillStyle = background;
  context.fillRect(0, 0, plan.outputSize, plan.outputSize);
  context.save();
  context.scale(plan.scale, plan.scale);
  context.fillStyle = foreground;

  for (const module of plan.darkModules) {
    if (module.shape === 'square') {
      context.fillRect(module.x, module.y, 1, 1);
    } else if (module.shape === 'circle') {
      context.beginPath();
      context.arc(module.x + 0.5, module.y + 0.5, module.radius, 0, Math.PI * 2);
      context.fill();
    } else if (module.shape === 'rounded') {
      drawRoundedModule(context, module);
    } else {
      drawChamferedModule(context, module);
    }
  }

  context.restore();
}

export function renderQrPlanToCanvas(plan, foreground, background) {
  const canvas = document.createElement('canvas');
  canvas.width = plan.outputSize;
  canvas.height = plan.outputSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The QR preview could not be drawn.');
  drawQrPlanToCanvas(context, plan, foreground, background);
  return canvas;
}

function moduleSvg(module, foreground) {
  if (module.shape === 'circle') {
    return `<circle cx="${module.x + 0.5}" cy="${module.y + 0.5}" r="${module.radius}" fill="${foreground}"/>`;
  }
  if (module.shape === 'rounded') {
    const width = 1 - module.inset * 2;
    return `<rect x="${module.x + module.inset}" y="${module.y + module.inset}" width="${width}" height="${width}" rx="${module.radius}" fill="${foreground}"/>`;
  }
  if (module.shape === 'chamfered') {
    const x = module.x + module.inset;
    const y = module.y + module.inset;
    const end = 1 - module.inset;
    const cut = module.cut;
    const points = [
      [x + cut, y],
      [end - cut, y],
      [end, y + cut],
      [end, end - cut],
      [end - cut, end],
      [x + cut, end],
      [x, end - cut],
      [x, y + cut],
    ].map(([pointX, pointY]) => `${pointX},${pointY}`).join(' ');
    return `<polygon points="${points}" fill="${foreground}"/>`;
  }
  return `<rect x="${module.x}" y="${module.y}" width="1" height="1" fill="${foreground}"/>`;
}

export function renderQrPlanToSvg(plan, foreground, background) {
  assertHexColor(foreground);
  assertHexColor(background);
  const modules = plan.darkModules.map((module) => moduleSvg(module, foreground)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.outputSize}" height="${plan.outputSize}" viewBox="0 0 ${plan.moduleCount} ${plan.moduleCount}" shape-rendering="geometricPrecision"><rect width="${plan.moduleCount}" height="${plan.moduleCount}" fill="${background}"/>${modules}</svg>`;
}

export function createQrMatrix(content, errorCorrectionLevel) {
  return QRCode.create(content, { errorCorrectionLevel });
}
