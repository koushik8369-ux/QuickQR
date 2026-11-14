import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { buildQrContent, validateForm } from './qrContent.js';
import {
  addQrHistoryEntry,
  createQrHistoryEntry,
  getQrHistoryEntry,
  readQrHistory,
  removeQrHistoryEntry,
  writeQrHistory,
} from './qrHistory.js';
import {
  applyLogoToPng,
  applyLogoToSvg,
  createHistoryLogoDataUrl,
  MAX_LOGO_SIZE_PERCENT,
  MIN_LOGO_SIZE_PERCENT,
  readLogoFile,
} from './qrLogo.js';
import {
  applyManualQrColor,
  applyQrColorTheme,
  getQrColorTheme,
  hasScannableQrContrast,
  QR_COLOR_THEMES,
} from './qrThemes.js';
import './App.css';

const QR_TYPES = [
  { id: 'text', label: 'Text', icon: 'Aa' },
  { id: 'website', label: 'Website URL', icon: '↗' },
  { id: 'video', label: 'Video URL', icon: '▶' },
  { id: 'email', label: 'Email', icon: '✉' },
  { id: 'phone', label: 'Phone', icon: '⌕' },
  { id: 'wifi', label: 'Wi-Fi', icon: '⌁' },
  { id: 'contact', label: 'Contact', icon: '▤' },
];

const INITIAL_VALUES = {
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

const INITIAL_SETTINGS = {
  size: 320,
  colorTheme: 'matrix',
  foreground: '#39FF14',
  background: '#071A12',
  logoDataUrl: '',
  logoEnabled: false,
  logoSize: 18,
};

const MATRIX_CHARACTERS = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン<>[]{}#$%';

function MatrixRain() {
  const canvasRef = useRef(null);
  const [motionAllowed, setMotionAllowed] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionPreference = () => setMotionAllowed(!motionPreference.matches);
    motionPreference.addEventListener('change', updateMotionPreference);
    return () => motionPreference.removeEventListener('change', updateMotionPreference);
  }, []);

  useEffect(() => {
    if (!motionAllowed) return undefined;

    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const shell = canvas?.parentElement;
    if (!canvas || !context || !shell) return undefined;

    let columns = [];
    let animationFrame = 0;
    let lastFrameTime = 0;
    let width = 0;
    let height = 0;
    const frameInterval = 1000 / 30;

    const resizeCanvas = () => {
      const bounds = shell.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 620 ? 1 : 1.5);
      const mobile = window.innerWidth < 620;
      const fontSize = mobile ? 13 : 15;
      const columnGap = mobile ? 25 : 23;

      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.font = `${fontSize}px monospace`;
      context.textBaseline = 'top';

      const columnCount = Math.ceil(width / columnGap);
      columns = Array.from({ length: columnCount }, (_, index) => ({
        x: index * columnGap + Math.random() * 5,
        y: Math.random() * height,
        speed: (mobile ? 34 : 43) + Math.random() * (mobile ? 34 : 57),
        tailLength: 4 + Math.floor(Math.random() * 7),
        fontSize,
      }));
    };

    const drawFrame = (time) => {
      animationFrame = window.requestAnimationFrame(drawFrame);
      if (time - lastFrameTime < frameInterval) return;

      const elapsed = lastFrameTime ? Math.min((time - lastFrameTime) / 1000, 0.05) : 0;
      lastFrameTime = time;
      context.fillStyle = 'rgba(2, 10, 5, 0.16)';
      context.fillRect(0, 0, width, height);

      columns.forEach((column) => {
        for (let tail = column.tailLength; tail >= 0; tail -= 1) {
          const y = column.y - tail * column.fontSize;
          if (y < -column.fontSize || y > height) continue;

          const character = MATRIX_CHARACTERS[Math.floor(Math.random() * MATRIX_CHARACTERS.length)];
          context.globalAlpha = tail === 0 ? 0.78 : 0.34 * (1 - tail / (column.tailLength + 1));
          context.fillStyle = tail === 0 ? '#39FF14' : tail % 3 === 0 ? '#00C853' : '#00E676';
          if (tail === 0) {
            context.shadowColor = '#39FF14';
            context.shadowBlur = 6;
          }
          context.fillText(character, column.x, y);
          context.shadowBlur = 0;
        }

        column.y += column.speed * elapsed;
        if (column.y - column.tailLength * column.fontSize > height) {
          column.y = -Math.random() * height * 0.35;
          column.speed = (window.innerWidth < 620 ? 34 : 43) + Math.random() * 65;
        }
      });

      context.globalAlpha = 1;
    };

    resizeCanvas();
    const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(resizeCanvas) : null;
    resizeObserver?.observe(shell);
    window.addEventListener('resize', resizeCanvas);
    animationFrame = window.requestAnimationFrame(drawFrame);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resizeCanvas);
      resizeObserver?.disconnect();
    };
  }, [motionAllowed]);

  if (!motionAllowed) return null;

  return <canvas ref={canvasRef} className="matrix-rain" aria-hidden="true" />;
}

function Header() {
  return (
    <header className="site-header reveal">
      <a className="brand reveal" href="#home" aria-label="QuickQR home">
        <span className="brand-copy">
          <span className="brand-name">Quick<span className="brand-accent">QR</span></span>
          <span className="brand-tagline">Generate. Customize. Download.</span>
        </span>
      </a>
      <nav className="main-nav" aria-label="Main navigation">
        <a className="nav-link active reveal" href="#home">Home</a>
        <a className="nav-link reveal" href="#about">About</a>
      </nav>
      <a className="header-action reveal" href="#generator">Create a QR <span aria-hidden="true">↗</span></a>
    </header>
  );
}

function TypeTabs({ selected, onSelect }) {
  return (
    <div className="type-tabs reveal" role="tablist" aria-label="QR code content type">
      {QR_TYPES.map(({ id, label, icon }, index) => (
        <button
          className={`type-tab reveal${selected === id ? ' selected' : ''}`}
          id={`tab-${id}`}
          key={id}
          type="button"
          style={{ '--reveal-delay': `${index * 45}ms` }}
          role="tab"
          aria-selected={selected === id}
          tabIndex={selected === id ? 0 : -1}
          aria-controls="qr-form"
          onClick={() => onSelect(id)}
          onKeyDown={(event) => {
            const currentIndex = QR_TYPES.findIndex((type) => type.id === id);
            let nextIndex = currentIndex;
            if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % QR_TYPES.length;
            else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + QR_TYPES.length) % QR_TYPES.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = QR_TYPES.length - 1;
            else return;
            event.preventDefault();
            onSelect(QR_TYPES[nextIndex].id);
            event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[nextIndex].focus();
          }}
        >
          <span className="tab-icon" aria-hidden="true">{icon}</span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function Field({ id, label, error, hint, as = 'input', className = '', ...props }) {
  const Control = as;
  return (
    <div className={`field reveal ${className}`}>
      <label className="reveal" htmlFor={id}>{label}</label>
      <Control
        id={id}
        className={`form-control reveal${error ? ' invalid' : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {hint && <small className="field-hint" id={`${id}-hint`}>{hint}</small>}
      {error && <small className="field-error" id={`${id}-error`}>{error}</small>}
    </div>
  );
}

function FormFields({ type, values, onChange, errors, onBlur }) {
  const field = (name, label, props = {}) => (
    <Field
      id={`field-${name}`}
      key={name}
      label={label}
      value={values[name]}
      onChange={(event) => onChange(name, event.target.value)}
      onBlur={() => onBlur(name)}
      error={errors[name]}
      {...props}
    />
  );

  if (type === 'text') {
    return field('text', 'Your text', {
      as: 'textarea',
      rows: 5,
      placeholder: 'Type a message, paste a code, or add any text…',
      maxLength: 3000,
    });
  }
  if (type === 'website' || type === 'video') {
    return field(type, type === 'website' ? 'Website address' : 'Video address', {
      type: 'url',
      placeholder: 'https://example.com',
      autoCapitalize: 'none',
      autoComplete: 'url',
      maxLength: 2048,
      hint: type === 'video' ? 'Paste a public video link that opens in a browser.' : 'Include https:// for the most reliable scan.',
    });
  }
  if (type === 'email') {
    return (
      <>
        {field('email', 'Email address', { type: 'email', placeholder: 'hello@example.com', autoComplete: 'email', maxLength: 254 })}
        {field('subject', 'Subject (optional)', { placeholder: 'A quick hello', maxLength: 120 })}
        {field('message', 'Message (optional)', { as: 'textarea', rows: 3, placeholder: 'Write a message…', maxLength: 500 })}
      </>
    );
  }
  if (type === 'phone') {
    return field('phone', 'Phone number', {
      type: 'tel',
      placeholder: '+1 (555) 123-4567',
      autoComplete: 'tel',
      maxLength: 24,
      hint: 'Use 7–15 digits. A leading + is optional.',
    });
  }
  if (type === 'wifi') {
    return (
      <>
        {field('ssid', 'Network name (SSID)', { placeholder: 'Your Wi-Fi network', maxLength: 32, autoComplete: 'off' })}
        <Field
          id="field-security"
          label="Security"
          as="select"
          value={values.security}
          onChange={(event) => {
            const security = event.target.value;
            onChange('security', security);
            if (security === 'nopass') onChange('password', '');
          }}
          onBlur={() => onBlur('security')}
          error={errors.security}
        >
          <option value="WPA">WPA / WPA2 / WPA3</option>
          <option value="WEP">WEP</option>
          <option value="nopass">No password</option>
        </Field>
        {values.security !== 'nopass' && field('password', 'Wi-Fi password', {
          type: 'password',
          placeholder: 'Enter network password',
          autoComplete: 'new-password',
          maxLength: 64,
          hint: values.security === 'WPA' ? 'WPA passwords use 8–63 characters or 64 hexadecimal digits.' : 'WEP passwords use 5 or 13 characters, or 10 or 26 hexadecimal digits.',
        })}
        <label className="checkbox-field reveal">
          <input type="checkbox" checked={values.hidden} onChange={(event) => onChange('hidden', event.target.checked)} />
          <span className="custom-checkbox" aria-hidden="true" />
          <span>Hidden network</span>
        </label>
      </>
    );
  }
  return (
    <>
      {field('fullName', 'Contact name', { placeholder: 'Alex Morgan', autoComplete: 'name', maxLength: 100 })}
      {field('organization', 'Organization (optional)', { placeholder: 'Company or team', autoComplete: 'organization', maxLength: 100 })}
      {field('contactPhone', 'Phone number (optional)', { type: 'tel', placeholder: '+1 (555) 123-4567', autoComplete: 'tel', maxLength: 24 })}
      {field('contactEmail', 'Email address (optional)', { type: 'email', placeholder: 'alex@example.com', autoComplete: 'email', maxLength: 254 })}
      {field('contactWebsite', 'Website (optional)', { type: 'url', placeholder: 'https://example.com', autoCapitalize: 'none', maxLength: 2048 })}
    </>
  );
}

function QrSettings({ settings, onChange, onThemeSelect, onLogoUpload, onLogoRemove, logoError }) {
  const selectedTheme = getQrColorTheme(settings.colorTheme);
  return (
    <section className="settings-section reveal" aria-labelledby="settings-title">
      <div className="section-heading reveal">
        <h3 id="settings-title">Customize your QR</h3>
        <span className="heading-note">Make it yours</span>
      </div>
      <div className="settings-grid">
        <div className="field reveal">
          <label className="reveal" htmlFor="qr-size">Image size</label>
          <select className="form-control reveal" id="qr-size" value={settings.size} onChange={(event) => onChange('size', Number(event.target.value))}>
            {[128, 256, 320, 512, 1024].map((size) => <option value={size} key={size}>{size} × {size} px</option>)}
          </select>
        </div>
        <ColorPicker id="qr-foreground" label="QR color" value={settings.foreground} onChange={(value) => onChange('foreground', value)} />
        <ColorPicker id="qr-background" label="Background" value={settings.background} onChange={(value) => onChange('background', value)} />
      </div>
      <div className="theme-picker reveal" aria-labelledby="theme-picker-title">
        <div className="theme-picker-heading">
          <div>
            <h4 id="theme-picker-title">Colour Themes</h4>
            <p className="settings-hint">Choose a ready-made palette or fine-tune either colour.</p>
          </div>
          <span className="theme-current" aria-live="polite">
            {selectedTheme?.name ?? 'Custom'}
          </span>
        </div>
        <div className="theme-grid" role="group" aria-label="QR colour themes">
          {QR_COLOR_THEMES.map((theme) => (
            <button
              className="theme-card"
              type="button"
              key={theme.id}
              aria-pressed={settings.colorTheme === theme.id}
              aria-label={`${theme.name} theme. QR colour ${theme.foreground}, background ${theme.background}.`}
              onClick={() => onThemeSelect(theme.id)}
            >
              <span className="theme-card-top" aria-hidden="true">
                <span className="theme-preview" style={{ backgroundColor: theme.background }}>
                  <span
                    className="theme-mini-qr"
                    style={{
                      '--theme-foreground': theme.foreground,
                      '--theme-background': theme.background,
                    }}
                  />
                </span>
                <span className="theme-selection-indicator">✓</span>
              </span>
              <span className="theme-card-name">{theme.name}</span>
              <span className="theme-colour-values">
                <span className="theme-colour-dots" aria-hidden="true">
                  <span style={{ backgroundColor: theme.foreground }} />
                  <span style={{ backgroundColor: theme.background }} />
                </span>
                <span className="theme-hex-pair">{theme.foreground} · {theme.background}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <p className="settings-hint reveal">High contrast helps your QR scan on more devices.</p>
      <div className="logo-settings reveal">
        <div className="section-heading">
          <div>
            <h3>Add Your Logo</h3>
            <p className="settings-hint">PNG, JPG, JPEG, or WEBP. Maximum file size: 2 MB.</p>
          </div>
          {settings.logoDataUrl && (
            <img className="logo-upload-preview" src={settings.logoDataUrl} alt="Uploaded logo preview" />
          )}
        </div>
        <label className="logo-file-label" htmlFor="qr-logo">Choose logo image</label>
        <input
          className="form-control logo-file-input"
          id="qr-logo"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          aria-describedby={logoError ? 'qr-logo-error' : 'qr-logo-hint'}
          onChange={onLogoUpload}
        />
        <small className="field-hint" id="qr-logo-hint">The logo is stored only in this browser when saved in your QR history.</small>
        {logoError && <small className="field-error" id="qr-logo-error" role="alert">{logoError}</small>}
        {settings.logoDataUrl && (
          <>
            <div className="logo-options">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={settings.logoEnabled}
                  onChange={(event) => onChange('logoEnabled', event.target.checked)}
                />
                <span className="custom-checkbox" aria-hidden="true" />
                <span>Show logo on QR code</span>
              </label>
              <button className="button button-quiet logo-remove" type="button" onClick={onLogoRemove}>
                Remove logo
              </button>
            </div>
            <label className="logo-size-control" htmlFor="qr-logo-size">
              <span>Logo size</span>
              <span>{settings.logoSize}%</span>
            </label>
            <input
              className="logo-size-slider"
              id="qr-logo-size"
              type="range"
              min={MIN_LOGO_SIZE_PERCENT}
              max={MAX_LOGO_SIZE_PERCENT}
              value={settings.logoSize}
              disabled={!settings.logoEnabled}
              onChange={(event) => onChange('logoSize', Number(event.target.value))}
            />
            <small className="field-hint">High error correction and white padding help keep the code scannable.</small>
          </>
        )}
      </div>
    </section>
  );
}

function ColorPicker({ id, label, value, onChange }) {
  return (
    <div className="field color-field reveal">
      <label className="reveal" htmlFor={id}>{label}</label>
      <div className="color-control reveal">
        <input className="reveal" id={id} type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${label} color`} />
        <span>{value.toUpperCase()}</span>
      </div>
    </div>
  );
}

function PreviewCard({ qr, svgUrl, error, svgError, onClear }) {
  return (
    <section className="preview-card reveal" aria-labelledby="preview-title">
      <div className="preview-heading reveal">
        <div>
          <p className="eyebrow">YOUR PREVIEW</p>
          <h2 id="preview-title">See it come to life</h2>
        </div>
        <span className={`status-pill${qr ? ' ready' : ''}`}>
          <span className="status-dot" />{qr ? 'Ready to scan' : 'Live preview'}
        </span>
      </div>
      <div className={`qr-stage reveal${qr ? ' has-qr' : ''}`}>
        {qr ? (
          <img key={qr} className="qr-image reveal" src={qr} alt="Generated QR code preview" />
        ) : (
          <div className="empty-preview reveal">
            <div className="qr-placeholder" aria-hidden="true">
              <span className="finder finder-top-left" /><span className="finder finder-top-right" />
              <span className="finder finder-bottom-left" /><span className="placeholder-core" />
            </div>
            <strong>Your QR code appears here</strong>
            <span>Choose a type and add your content to get started.</span>
          </div>
        )}
      </div>
      <div className="preview-caption reveal">
        <span className="caption-icon" aria-hidden="true">⌁</span>
        <span>Generated privately in your browser. Your data never leaves this device.</span>
      </div>
      {error && <p className="generation-error" role="alert">{error}</p>}
      {svgError && <p className="generation-error" role="alert">{svgError}</p>}
      <div className="preview-actions reveal">
        {qr && <a className="button button-download reveal" href={qr} download="quickqr.png"><span aria-hidden="true">↓</span> Download PNG</a>}
        {svgUrl && <a className="button button-download reveal" href={svgUrl} download="quickqr.svg"><span aria-hidden="true">↓</span> Download SVG</a>}
        <button className="button button-quiet reveal" type="button" onClick={onClear}>Clear</button>
      </div>
    </section>
  );
}

function HistoryCard({ entries, error, onRestore, onDelete, onClearAll }) {
  return (
    <section className="history-card reveal" aria-labelledby="history-title">
      <div className="history-heading">
        <div>
          <p className="eyebrow">ON THIS DEVICE</p>
          <h2 id="history-title">Generation history</h2>
        </div>
        {entries.length > 0 && (
          <button className="button button-quiet history-clear" type="button" onClick={onClearAll}>
            Clear all history
          </button>
        )}
      </div>
      {error && (
        <p className="history-notice" role="status">
          QR history could not be read or saved. Your current QR code and downloads are still available.
        </p>
      )}
      <p className="history-privacy">Wi-Fi QR codes are not saved because they may contain passwords.</p>
      {entries.length ? (
        <ol className="history-list">
          {entries.map((entry) => (
            <li className="history-entry" key={entry.id}>
              <div className="history-entry-info">
                <strong>{QR_TYPES.find((type) => type.id === entry.type)?.label ?? entry.type}</strong>
                <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
              </div>
              <div className="history-entry-actions">
                <button className="button button-download" type="button" onClick={() => onRestore(entry.id)}>
                  Restore
                </button>
                <button
                  className="button button-quiet"
                  type="button"
                  aria-label={`Delete ${entry.type} QR from history`}
                  onClick={() => onDelete(entry.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="history-empty">Your generated QR codes will appear here after you choose Generate QR.</p>
      )}
    </section>
  );
}

function About() {
  return (
    <section id="about" className="about-section reveal">
      <span className="about-icon reveal" aria-hidden="true">⌘</span>
      <div className="reveal">
        <h2>Simple, private, yours.</h2>
        <p>QuickQR creates useful, high-quality QR codes right in your browser. Nothing is uploaded or stored on a server.</p>
      </div>
    </section>
  );
}

function App() {
  const [type, setType] = useState('text');
  const [values, setValues] = useState(INITIAL_VALUES);
  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [generationRequest, setGenerationRequest] = useState(0);
  const [qr, setQr] = useState('');
  const [svgUrl, setSvgUrl] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [svgError, setSvgError] = useState('');
  const [logoError, setLogoError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [initialHistory] = useState(readQrHistory);
  const [history, setHistory] = useState(initialHistory.entries);
  const [historyStorageError, setHistoryStorageError] = useState(initialHistory.error);
  const historyRef = useRef(initialHistory.entries);
  const explicitGenerationRef = useRef(null);

  useEffect(() => {
    if (!svgUrl) return undefined;
    return () => URL.revokeObjectURL(svgUrl);
  }, [svgUrl]);

  useEffect(() => {
    document.documentElement.classList.add('reveal-ready');
    return () => document.documentElement.classList.remove('reveal-ready');
  }, []);

  useEffect(() => {
    const elements = document.querySelectorAll('.reveal:not(.is-visible)');
    if (!('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'));
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });

    elements.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      observer.disconnect();
    };
  }, [type, qr, generationError, submitted, history]);

  const validation = useMemo(() => validateForm(type, values), [type, values]);
  const visibleErrors = useMemo(() => Object.fromEntries(
    Object.entries(validation.errors).filter(([field]) => submitted || touched[field]),
  ), [validation.errors, submitted, touched]);

  useEffect(() => {
    let active = true;
    const explicitGeneration = explicitGenerationRef.current?.requestId === generationRequest
      ? explicitGenerationRef.current
      : null;
    setQr('');
    setSvgUrl('');
    setGenerationError('');
    setSvgError('');
    if (!validation.valid) {
      setGenerating(false);
      return () => { active = false; };
    }

    const content = buildQrContent(type, values);
    const timer = window.setTimeout(async () => {
      if (!active) return;
      if (!hasScannableQrContrast(settings.foreground, settings.background)) {
        setGenerationError('Choose colors with at least 3:1 contrast for a reliably scannable QR code.');
        setGenerating(false);
        if (explicitGeneration) explicitGenerationRef.current = null;
        return;
      }
      setGenerating(true);
      try {
        const options = {
          width: settings.size,
          margin: 2,
          errorCorrectionLevel: settings.logoEnabled && settings.logoDataUrl ? 'H' : 'M',
          color: { dark: settings.foreground, light: settings.background },
        };
        const dataUrl = await QRCode.toDataURL(content, options);
        const logoEnabled = settings.logoEnabled && Boolean(settings.logoDataUrl);
        const previewDataUrl = logoEnabled
          ? await applyLogoToPng(dataUrl, settings.logoDataUrl, settings.logoSize)
          : dataUrl;
        if (active) {
          setQr(previewDataUrl);
          if (explicitGeneration) {
            if (type !== 'wifi') {
              try {
                const historySettings = {
                  ...settings,
                  logoDataUrl: settings.logoDataUrl
                    ? await createHistoryLogoDataUrl(settings.logoDataUrl)
                    : '',
                };
                const entry = createQrHistoryEntry({
                  type,
                  values,
                  payload: content,
                  settings: historySettings,
                });
                if (entry) {
                  const nextHistory = addQrHistoryEntry(historyRef.current, entry);
                  historyRef.current = nextHistory;
                  setHistory(nextHistory);
                  setHistoryStorageError(!writeQrHistory(nextHistory));
                }
              } catch {
                setHistoryStorageError(true);
              }
            }
            explicitGenerationRef.current = null;
          }
        }
        try {
          const plainSvg = await QRCode.toString(content, { ...options, type: 'svg' });
          const svgMarkup = logoEnabled
            ? applyLogoToSvg(plainSvg, settings.logoDataUrl, settings.logoSize)
            : plainSvg;
          if (active) {
            const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
            setSvgUrl(URL.createObjectURL(svgBlob));
          }
        } catch {
          if (active) setSvgError('The SVG version could not be created. You can still download the PNG.');
        }
      } catch {
        if (active) {
          setGenerationError('This QR code could not be generated. Try shortening the content or using a different logo.');
          if (explicitGeneration) explicitGenerationRef.current = null;
        }
      } finally {
        if (active) setGenerating(false);
      }
    }, generationRequest ? 0 : 140);

    return () => {
      active = false;
      if (explicitGenerationRef.current === explicitGeneration) explicitGenerationRef.current = null;
      window.clearTimeout(timer);
    };
  }, [type, values, settings, generationRequest, validation.valid]);

  const updateValue = (name, value) => setValues((current) => ({ ...current, [name]: value }));
  const updateSetting = (name, value) => {
    if (name === 'foreground' || name === 'background') {
      setSettings((current) => applyManualQrColor(current, name, value));
      return;
    }
    setSettings((current) => ({ ...current, [name]: value }));
  };
  const selectTheme = (themeId) => {
    setSettings((current) => applyQrColorTheme(current, themeId));
  };

  const handleGenerate = () => {
    setSubmitted(true);
    if (validation.valid) {
      const requestId = generationRequest + 1;
      explicitGenerationRef.current = { requestId };
      setGenerationRequest(requestId);
    }
  };

  const handleClear = () => {
    explicitGenerationRef.current = null;
    setValues(INITIAL_VALUES);
    setTouched({});
    setSubmitted(false);
    setQr('');
    setSvgUrl('');
    setGenerationError('');
    setSvgError('');
    setGenerating(false);
    setGenerationRequest((request) => request + 1);
  };

  const saveHistoryChanges = (nextHistory) => {
    historyRef.current = nextHistory;
    setHistory(nextHistory);
    setHistoryStorageError(!writeQrHistory(nextHistory));
  };

  const handleRestore = (id) => {
    const entry = getQrHistoryEntry(historyRef.current, id);
    if (!entry) return;
    explicitGenerationRef.current = null;
    setType(entry.type);
    setValues({ ...INITIAL_VALUES, ...entry.values });
    setSettings({ ...INITIAL_SETTINGS, ...entry.settings });
    setTouched({});
    setSubmitted(false);
    setGenerationError('');
    setLogoError('');
    setGenerationRequest((request) => request + 1);
  };

  const handleDeleteHistoryEntry = (id) => {
    saveHistoryChanges(removeQrHistoryEntry(historyRef.current, id));
  };

  const handleClearHistory = () => {
    if (window.confirm('Clear all saved QR history? This cannot be undone.')) {
      saveHistoryChanges([]);
    }
  };

  return (
    <div id="home" className="app-shell">
      <MatrixRain />
      <div className="app-content">
        <Header />
        <main>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-kicker reveal"><span className="kicker-spark">✳</span> YOUR IDEAS, IN A SCAN</div>
            <h1 id="hero-title" className="reveal">Generate Your<br /><span>QR Code</span></h1>
            <p className="hero-copy reveal">Create a QR code for text, links, contact details, and more — right in your browser.</p>
          </section>

          <section className="workspace reveal" id="generator" aria-label="QR code generator">
            <div className="generator-card reveal">
              <div className="card-title-row reveal">
                <div>
                  <p className="eyebrow">GET STARTED</p>
                  <h2>What would you like to share?</h2>
                </div>
                <span className="step-indicator"><span>01</span> / 02</span>
              </div>
              <TypeTabs selected={type} onSelect={(nextType) => { setType(nextType); setSubmitted(false); setTouched({}); }} />
              <form
                id="qr-form"
                key={type}
                className="qr-form reveal"
                role="tabpanel"
                aria-labelledby={`tab-${type}`}
                onSubmit={(event) => { event.preventDefault(); handleGenerate(); }}
                noValidate
              >
                <div className="fields-grid">
                  <FormFields
                    type={type}
                    values={values}
                    onChange={updateValue}
                    errors={visibleErrors}
                    onBlur={(name) => setTouched((current) => ({ ...current, [name]: true }))}
                  />
                </div>
                <QrSettings
                  settings={settings}
                  onChange={updateSetting}
                  onThemeSelect={selectTheme}
                  onLogoUpload={async (event) => {
                    const [file] = event.target.files ?? [];
                    event.target.value = '';
                    if (!file) return;
                    setLogoError('');
                    try {
                      const logoDataUrl = await readLogoFile(file);
                      setSettings((current) => ({ ...current, logoDataUrl, logoEnabled: true }));
                    } catch (error) {
                      setLogoError(error.message);
                    }
                  }}
                  onLogoRemove={() => {
                    setSettings((current) => ({ ...current, logoDataUrl: '', logoEnabled: false }));
                    setLogoError('');
                  }}
                  logoError={logoError}
                />
                <div className="form-footer reveal">
                  <p className="reveal"><span className="privacy-lock" aria-hidden="true">◈</span> No sign-up. No tracking. Just QR.</p>
                  <button className="button button-primary reveal" type="submit" disabled={generating}>
                    {generating ? 'Generating…' : 'Generate QR'} <span aria-hidden="true">↗</span>
                  </button>
                </div>
                {submitted && Object.keys(validation.errors).length > 0 && (
                  <p className="form-notice reveal" role="alert">Check the highlighted field{Object.keys(validation.errors).length === 1 ? '' : 's'} and try again.</p>
                )}
              </form>
            </div>
            <PreviewCard
              qr={qr}
              svgUrl={svgUrl}
              error={generationError}
              svgError={svgError}
              onClear={handleClear}
            />
          </section>
          <HistoryCard
            entries={history}
            error={historyStorageError}
            onRestore={handleRestore}
            onDelete={handleDeleteHistoryEntry}
            onClearAll={handleClearHistory}
          />
          <About />
        </main>
        <footer className="site-footer reveal">
          <a className="brand footer-brand reveal" href="#home"><span className="brand-name">Quick<span className="brand-accent">QR</span></span></a>
          <span className="reveal">Made for sharing. Built for privacy.</span>
          <a className="reveal" href="#home">Back to top ↑</a>
        </footer>
      </div>
    </div>
  );
}

export default App;
