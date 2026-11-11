export const MAX_LOGO_FILE_SIZE = 2 * 1024 * 1024;
export const MIN_LOGO_SIZE_PERCENT = 12;
export const MAX_LOGO_SIZE_PERCENT = 24;

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

export async function applyLogoToPng(qrDataUrl, logoDataUrl, logoSizePercent) {
  if (!LOGO_DATA_URL_PATTERN.test(logoDataUrl)) throw new Error('The logo image is invalid.');
  const [qrImage, logoImage] = await Promise.all([loadImage(qrDataUrl), loadImage(logoDataUrl)]);
  const canvas = document.createElement('canvas');
  canvas.width = qrImage.naturalWidth;
  canvas.height = qrImage.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The logo could not be drawn on the QR code.');

  context.drawImage(qrImage, 0, 0);
  const logoBoxSize = Math.min(canvas.width, canvas.height) * (logoSizePercent / 100);
  const padding = Math.max(4, logoBoxSize * 0.16);
  const backingSize = logoBoxSize + padding * 2;
  const backingX = (canvas.width - backingSize) / 2;
  const backingY = (canvas.height - backingSize) / 2;
  context.fillStyle = '#ffffff';
  context.fillRect(backingX, backingY, backingSize, backingSize);

  const scale = Math.min(logoBoxSize / logoImage.naturalWidth, logoBoxSize / logoImage.naturalHeight);
  const width = logoImage.naturalWidth * scale;
  const height = logoImage.naturalHeight * scale;
  context.drawImage(
    logoImage,
    (canvas.width - width) / 2,
    (canvas.height - height) / 2,
    width,
    height,
  );
  return canvas.toDataURL('image/png');
}

export function applyLogoToSvg(svg, logoDataUrl, logoSizePercent) {
  if (!LOGO_DATA_URL_PATTERN.test(logoDataUrl)) throw new Error('The logo image is invalid.');
  const viewBox = svg.match(/\bviewBox="([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)"/);
  if (!viewBox) throw new Error('The generated SVG has no usable viewBox.');

  const [, minX, minY, viewWidth, viewHeight] = viewBox.map(Number);
  const logoBoxSize = Math.min(viewWidth, viewHeight) * (logoSizePercent / 100);
  const padding = logoBoxSize * 0.16;
  const backingSize = logoBoxSize + padding * 2;
  const x = minX + (viewWidth - backingSize) / 2;
  const y = minY + (viewHeight - backingSize) / 2;
  const logoX = minX + (viewWidth - logoBoxSize) / 2;
  const logoY = minY + (viewHeight - logoBoxSize) / 2;
  const logoMarkup = `<g data-quickqr-logo="true"><rect x="${x}" y="${y}" width="${backingSize}" height="${backingSize}" fill="#ffffff"/><image x="${logoX}" y="${logoY}" width="${logoBoxSize}" height="${logoBoxSize}" href="${logoDataUrl}" preserveAspectRatio="xMidYMid meet"/></g>`;

  return svg.replace(/<\/svg>\s*$/, `${logoMarkup}</svg>`);
}
