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

test('generates browser-compatible PNG and SVG downloads using the selected size and colors', async () => {
  const options = {
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#123456', light: '#fedcba' },
  };
  const png = await QRCode.toDataURL('WIFI:T:WPA;S:Office;P:correcthorsebattery;;', {
    ...options,
  });
  assert.match(png, /^data:image\/png;base64,/);
  const svg = await QRCode.toString('WIFI:T:WPA;S:Office;P:correcthorsebattery;;', {
    ...options,
    type: 'svg',
  });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /width="512" height="512"/);
  assert.match(svg, /<path fill="#fedcba"/);
  assert.match(svg, /<path stroke="#123456"/);
  assert.match(svg, /<\/svg>\s*$/);
  await assert.rejects(QRCode.toDataURL('x'.repeat(10000)));
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
  const first = sampleHistoryEntry('first');
  const second = sampleHistoryEntry('second', { type: 'website' });

  assert.equal(writeQrHistory([second, first], storage), true);
  const reloaded = readQrHistory(storage);
  assert.equal(reloaded.error, false);
  assert.deepEqual(reloaded.entries, [second, first]);
  assert.deepEqual(getQrHistoryEntry(reloaded.entries, 'first'), first);

  const afterDelete = removeQrHistoryEntry(reloaded.entries, 'second');
  assert.deepEqual(afterDelete, [first]);
  assert.equal(writeQrHistory(afterDelete, storage), true);
  assert.deepEqual(readQrHistory(storage).entries, [first]);

  assert.equal(writeQrHistory([], storage), true);
  assert.deepEqual(readQrHistory(storage).entries, []);
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
