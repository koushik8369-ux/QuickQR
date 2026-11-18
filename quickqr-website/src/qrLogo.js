export const MAX_LOGO_FILE_SIZE = 2 * 1024 * 1024;
export const MIN_LOGO_SIZE_PERCENT = 12;
export const MAX_LOGO_SIZE_PERCENT = 24;
export const DEFAULT_LOGO_SIZE_PERCENT = 18;
export const LOGO_POSITION_OPTIONS = [
  { id: 'center', label: 'Center' },
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
];
export const LOGO_POSITION_IDS = LOGO_POSITION_OPTIONS.map(({ id }) => id);
export const DEFAULT_LOGO_POSITION = 'center';
export const MIN_LOGO_PADDING_PERCENT = 8;
export const MAX_LOGO_PADDING_PERCENT = 32;
export const DEFAULT_LOGO_PADDING_PERCENT = 16;

const LOGO_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const LOGO_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[\da-z+/]+=*$/i;

export function validateLogoFile(file) {
  if (!file || typeof file !== 'object') return 'Choose an image file.';
  if (file.size <= 0) return 'The selected image is empty.';
  if (file.size > MAX_LOGO_FILE_SIZE) return 'Choose an image smaller than 2 MB.';

  const extension = file.name?.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? '';
  const mimeType = file.type?.toLowerCase() ?? '';
  if (!LOGO_EXTENSIONS.has(extension) || (mimeType && !LOGO_MIMES.has(mimeType))) {
    return 'Choose a PNG, JPG, JPEG, or WEBP image.';
  }
  return '';
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be opened. Try a different PNG, JPG, JPEG, or WEBP file.'));
    image.src = source;
  });
}

export async function readLogoFile(file) {
  const validationError = validateLogoFile(file);
  if (validationError) throw new Error(validationError);

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The image could not be read. Try selecting it again.'));
    reader.readAsDataURL(file);
  });

  try {
    const image = await loadImage(dataUrl);
    if (image.naturalWidth * image.naturalHeight > 16_000_000) {
      throw new Error('Choose an image with dimensions no larger than 16 megapixels.');
    }
    const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The image could not be prepared for QR generation.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Choose an image with dimensions')) throw error;
    if (error instanceof Error && error.message.startsWith('The image could not be prepared')) throw error;
    throw new Error('The image could not be opened. Try a different PNG, JPG, JPEG, or WEBP file.');
  }
}

export async function createHistoryLogoDataUrl(dataUrl) {
  if (!LOGO_DATA_URL_PATTERN.test(dataUrl)) throw new Error('The saved logo image is invalid.');
  const image = await loadImage(dataUrl);
  const maxDataUrlLength = 80 * 1024;

  for (const maxDimension of [256, 192, 128, 96]) {
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The logo could not be prepared for history storage.');
    context.drawImage(image, 0, 0, width, height);
    const compactDataUrl = canvas.toDataURL('image/png');
    if (compactDataUrl.length <= maxDataUrlLength) return compactDataUrl;
  }

  throw new Error('The logo could not be compressed enough to save in QR history.');
}

export class LogoFinderOverlapError extends Error {
  constructor() {
    super('This logo backing would cover a QR finder pattern. Reduce the logo size or padding, or choose another position.');
    this.name = 'LogoFinderOverlapError';
  }
}

function validateLogoSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('The logo settings are invalid.');
  }
  const logoPosition = settings.logoPosition === undefined
    ? DEFAULT_LOGO_POSITION
    : settings.logoPosition;
  const logoSize = settings.logoSize === undefined ? DEFAULT_LOGO_SIZE_PERCENT : settings.logoSize;
  const logoPadding = settings.logoPadding === undefined
    ? DEFAULT_LOGO_PADDING_PERCENT
    : settings.logoPadding;

  if (!LOGO_POSITION_IDS.includes(logoPosition)) {
    throw new Error('Choose a supported logo position.');
  }
  if (!Number.isInteger(logoSize) || logoSize < MIN_LOGO_SIZE_PERCENT || logoSize > MAX_LOGO_SIZE_PERCENT) {
    throw new Error(`Logo size must be an integer between ${MIN_LOGO_SIZE_PERCENT} and ${MAX_LOGO_SIZE_PERCENT} percent.`);
  }
  if (
    !Number.isInteger(logoPadding)
    || logoPadding < MIN_LOGO_PADDING_PERCENT
    || logoPadding > MAX_LOGO_PADDING_PERCENT
  ) {
    throw new Error(`Logo padding must be an integer between ${MIN_LOGO_PADDING_PERCENT} and ${MAX_LOGO_PADDING_PERCENT} percent.`);
  }
  return { logoPosition, logoSize, logoPadding };
}

function intersects(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function getFinderPatternBounds(plan) {
  const { margin, moduleSize } = plan;
  const finderSize = 7;
  return [
    { x: margin, y: margin, width: finderSize, height: finderSize },
    { x: margin + moduleSize - finderSize, y: margin, width: finderSize, height: finderSize },
    { x: margin, y: margin + moduleSize - finderSize, width: finderSize, height: finderSize },
  ];
}

export function createLogoGeometry(plan, settings) {
  const { logoPosition, logoSize, logoPadding } = validateLogoSettings(settings);
  if (
    !plan
    || !Number.isInteger(plan.moduleCount)
    || !Number.isInteger(plan.moduleSize)
    || !Number.isInteger(plan.margin)
    || !Number.isInteger(plan.outputSize)
    || !Number.isFinite(plan.scale)
    || plan.moduleSize < 21
    || plan.margin < 2
    || plan.outputSize < 1
    || plan.scale <= 0
    || plan.moduleCount !== plan.moduleSize + plan.margin * 2
    || Math.abs(plan.moduleCount * plan.scale - plan.outputSize) > 0.000001
  ) {
    throw new Error('The QR render plan cannot be used to position a logo.');
  }

  const logoBoxSize = plan.moduleCount * (logoSize / 100);
  const padding = Math.max(4 / plan.scale, logoBoxSize * (logoPadding / 100));
  const backingSize = logoBoxSize + padding * 2;
  const centerX = plan.moduleCount / 2;
  const backingY = logoPosition === 'top'
    ? plan.margin
    : logoPosition === 'bottom'
      ? plan.margin + plan.moduleSize - backingSize
      : (plan.moduleCount - backingSize) / 2;
  const logo = {
    x: centerX - logoBoxSize / 2,
    y: backingY + padding,
    size: logoBoxSize,
  };
  const backing = {
    x: centerX - backingSize / 2,
    y: backingY,
    size: backingSize,
  };

  if (
    backing.x < 0
    || backing.y < 0
    || backing.x + backing.size > plan.moduleCount
    || backing.y + backing.size > plan.moduleCount
  ) {
    throw new Error('The logo backing must fit inside the QR image.');
  }

  const backingBounds = {
    x: backing.x,
    y: backing.y,
    width: backing.size,
    height: backing.size,
  };
  if (getFinderPatternBounds(plan).some((finder) => intersects(backingBounds, finder))) {
    throw new LogoFinderOverlapError();
  }

  return {
    moduleCount: plan.moduleCount,
    outputSize: plan.outputSize,
    scale: plan.scale,
    logoPosition,
    logoSize,
    logoPadding,
    logo,
    backing,
  };
}

function assertLogoGeometry(geometry) {
  const rectangles = [geometry?.logo, geometry?.backing];
  if (
    !geometry
    || !Number.isInteger(geometry.moduleCount)
    || !Number.isInteger(geometry.outputSize)
    || !Number.isFinite(geometry.scale)
    || geometry.scale <= 0
    || Math.abs(geometry.moduleCount * geometry.scale - geometry.outputSize) > 0.000001
    || rectangles.some((rectangle) => (
      !rectangle
      || !Number.isFinite(rectangle.x)
      || !Number.isFinite(rectangle.y)
      || !Number.isFinite(rectangle.size)
      || rectangle.size <= 0
    ))
    || geometry.backing.x < 0
    || geometry.backing.y < 0
    || geometry.backing.x + geometry.backing.size > geometry.moduleCount
    || geometry.backing.y + geometry.backing.size > geometry.moduleCount
    || geometry.logo.x < geometry.backing.x
    || geometry.logo.y < geometry.backing.y
    || geometry.logo.x + geometry.logo.size > geometry.backing.x + geometry.backing.size
    || geometry.logo.y + geometry.logo.size > geometry.backing.y + geometry.backing.size
  ) {
    throw new Error('The calculated logo geometry is invalid.');
  }
}

export async function applyLogoToPng(qrDataUrl, logoDataUrl, geometry) {
  if (!LOGO_DATA_URL_PATTERN.test(logoDataUrl)) throw new Error('The logo image is invalid.');
  assertLogoGeometry(geometry);
  const [qrImage, logoImage] = await Promise.all([loadImage(qrDataUrl), loadImage(logoDataUrl)]);
  if (qrImage.naturalWidth !== geometry.outputSize || qrImage.naturalHeight !== geometry.outputSize) {
    throw new Error('The QR image dimensions do not match the calculated logo placement.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = qrImage.naturalWidth;
  canvas.height = qrImage.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The logo could not be drawn on the QR code.');

  context.drawImage(qrImage, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(
    geometry.backing.x * geometry.scale,
    geometry.backing.y * geometry.scale,
    geometry.backing.size * geometry.scale,
    geometry.backing.size * geometry.scale,
  );

  const logoBoxPixels = geometry.logo.size * geometry.scale;
  const imageScale = Math.min(logoBoxPixels / logoImage.naturalWidth, logoBoxPixels / logoImage.naturalHeight);
  const width = logoImage.naturalWidth * imageScale;
  const height = logoImage.naturalHeight * imageScale;
  context.drawImage(
    logoImage,
    geometry.logo.x * geometry.scale + (logoBoxPixels - width) / 2,
    geometry.logo.y * geometry.scale + (logoBoxPixels - height) / 2,
    width,
    height,
  );
  return canvas.toDataURL('image/png');
}

export function applyLogoToSvg(svg, logoDataUrl, geometry) {
  if (!LOGO_DATA_URL_PATTERN.test(logoDataUrl)) throw new Error('The logo image is invalid.');
  assertLogoGeometry(geometry);
  const viewBox = svg.match(/\bviewBox="([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)"/);
  if (!viewBox) throw new Error('The generated SVG has no usable viewBox.');

  const [, minX, minY, viewWidth, viewHeight] = viewBox.map(Number);
  if (viewWidth !== geometry.moduleCount || viewHeight !== geometry.moduleCount) {
    throw new Error('The SVG dimensions do not match the calculated logo placement.');
  }
  const logoMarkup = `<g data-quickqr-logo="true"><rect x="${minX + geometry.backing.x}" y="${minY + geometry.backing.y}" width="${geometry.backing.size}" height="${geometry.backing.size}" fill="#ffffff"/><image x="${minX + geometry.logo.x}" y="${minY + geometry.logo.y}" width="${geometry.logo.size}" height="${geometry.logo.size}" href="${logoDataUrl}" preserveAspectRatio="xMidYMid meet"/></g>`;

  return svg.replace(/<\/svg>\s*$/, `${logoMarkup}</svg>`);
}
