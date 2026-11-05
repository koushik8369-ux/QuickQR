const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const PHONE_PATTERN = /^\+?[\d\s().-]+$/;
const HEX_PATTERN = /^[\da-f]+$/i;

function isValidEmail(value) {
  const email = value.trim();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return false;
  const [localPart, domain] = email.split('@');
  return localPart.length <= 64
    && !localPart.startsWith('.')
    && !localPart.endsWith('.')
    && !localPart.includes('..')
    && domain.split('.').every((part) => part.length <= 63);
}

function isValidUrl(value) {
  const candidate = value.trim();
  if (!candidate || candidate.length > 2048 || /[\u0000-\u0020\u007f]/.test(candidate)) return false;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol)
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && url.hostname.length <= 253;
  } catch {
    return false;
  }
}

function normalizedPhone(value) {
  const phone = value.trim();
  if (!phone || !PHONE_PATTERN.test(phone)) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return `${phone.startsWith('+') ? '+' : ''}${digits}`;
}

function utf8Length(value) {
  return new TextEncoder().encode(value).length;
}

function escapeWifi(value) {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

function escapeVCard(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/([;,])/g, '\\$1');
}

function normalizeOptionalUrl(value) {
  const trimmed = value.trim();
  return trimmed && isValidUrl(trimmed) ? trimmed : '';
}

export function validateForm(type, values) {
  const errors = {};
  const required = (key, message) => {
    if (!values[key].trim()) errors[key] = message;
  };

  if (type === 'text') {
    required('text', 'Enter some text to encode.');
  } else if (type === 'website' || type === 'video') {
    required(type, 'Enter a web address.');
    if (values[type].trim() && !isValidUrl(values[type])) errors[type] = 'Enter a valid http:// or https:// address without credentials.';
  } else if (type === 'email') {
    required('email', 'Enter an email address.');
    if (values.email.trim() && !isValidEmail(values.email)) errors.email = 'Enter a valid email address.';
  } else if (type === 'phone') {
    required('phone', 'Enter a phone number.');
    if (values.phone.trim() && !normalizedPhone(values.phone)) errors.phone = 'Enter 7–15 digits, with only an optional + and common separators.';
  } else if (type === 'wifi') {
    required('ssid', 'Enter your network name.');
    if (values.ssid && utf8Length(values.ssid) > 32) errors.ssid = 'Network names can be up to 32 UTF-8 bytes.';
    if (values.security !== 'nopass') {
      required('password', 'Enter the network password.');
      if (values.password) {
        const password = values.password;
        if (values.security === 'WPA') {
          const passwordBytes = utf8Length(password);
          if (!((passwordBytes >= 8 && passwordBytes <= 63) || (password.length === 64 && HEX_PATTERN.test(password)))) {
            errors.password = 'Use 8–63 characters or 64 hexadecimal digits for WPA.';
          }
        } else if (!(
          (/^[\x00-\x7f]+$/.test(password) && [5, 13].includes(utf8Length(password)))
          || ([10, 26].includes(password.length) && HEX_PATTERN.test(password))
        )) {
          errors.password = 'Use 5 or 13 characters, or 10 or 26 hexadecimal digits for WEP.';
        }
      }
    } else if (values.password) {
      errors.password = 'An open network must not have a password.';
    }
  } else if (type === 'contact') {
    required('fullName', 'Enter a contact name.');
    if (values.contactEmail.trim() && !isValidEmail(values.contactEmail)) errors.contactEmail = 'Enter a valid email address.';
    if (values.contactPhone.trim() && !normalizedPhone(values.contactPhone)) errors.contactPhone = 'Enter 7–15 digits, with only an optional + and common separators.';
    if (values.contactWebsite.trim() && !isValidUrl(values.contactWebsite)) errors.contactWebsite = 'Enter a valid http:// or https:// address.';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function buildQrContent(type, values) {
  if (!validateForm(type, values).valid) return '';

  if (type === 'text') return values.text.trim();
  if (type === 'website' || type === 'video') return values[type].trim();
  if (type === 'email') {
    const subject = values.subject.trim();
    const message = values.message.trim();
    const query = new URLSearchParams();
    if (subject) query.set('subject', subject);
    if (message) query.set('body', message);
    const suffix = query.toString();
    return `mailto:${values.email.trim()}${suffix ? `?${suffix}` : ''}`;
  }
  if (type === 'phone') return `tel:${normalizedPhone(values.phone)}`;
  if (type === 'wifi') {
    const security = values.security === 'nopass' ? 'nopass' : values.security;
    const password = security === 'nopass' ? '' : `;P:${escapeWifi(values.password)}`;
    return `WIFI:T:${security};S:${escapeWifi(values.ssid)}${password};${values.hidden ? 'H:true;' : ''};`;
  }

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVCard(values.fullName.trim())}`,
    `N:${escapeVCard(values.fullName.trim())};;;`,
  ];
  if (values.organization.trim()) lines.push(`ORG:${escapeVCard(values.organization.trim())}`);
  const phone = normalizedPhone(values.contactPhone);
  if (phone) lines.push(`TEL;TYPE=CELL:${phone}`);
  if (values.contactEmail.trim()) lines.push(`EMAIL;TYPE=INTERNET:${values.contactEmail.trim()}`);
  const website = normalizeOptionalUrl(values.contactWebsite);
  if (website) lines.push(`URL:${website}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}
