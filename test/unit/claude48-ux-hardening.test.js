'use strict';

// Regression tests for the Claude 4.8 UX maxout lane 11 — Clinical EHR safe
// UX hardening (synthetic-data demo). Source-level assertions in the
// established node:test idiom (see ui-quick-wins.test.js): parse the relevant
// source text and fail loudly if any hardening regresses. Browser/runtime
// render verification is the companion check.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.resolve(root, rel), 'utf8');

describe('a11y-viewport-zoom: index.html never disables user scaling (WCAG 1.4.4)', () => {
  const html = read('index.html');
  test('user-scalable=no is gone', () => {
    assert.ok(!/user-scalable\s*=\s*no/i.test(html), 'viewport must not disable user scaling');
  });
  test('viewport stays responsive', () => {
    assert.match(html, /width=device-width/);
  });
  test('a no-JS fallback message is present', () => {
    assert.match(html, /<noscript>/i);
  });
});

describe('safety-label: DemoBanner is the single synthetic-data label source', () => {
  const banner = read('src/components/common/DemoBanner.jsx');
  test('exports the canonical label string', () => {
    assert.match(banner, /Synthetic EHR Demo · No PHI · Not for clinical use/);
    assert.match(banner, /export const DEMO_LABEL/);
  });
  test('renders as an accessible note', () => {
    assert.match(banner, /role="note"/);
    assert.match(banner, /aria-label=\{DEMO_LABEL\}/);
  });
  test('supports inline + strip variants', () => {
    assert.match(banner, /variant === 'inline'/);
  });
});

describe('safety-label: every entry surface renders DemoBanner', () => {
  test('AppShell uses DemoBanner and drops the old contradictory banner', () => {
    const shell = read('src/components/layout/AppShell.jsx');
    assert.match(shell, /import DemoBanner from '\.\.\/common\/DemoBanner'/);
    assert.match(shell, /<DemoBanner className="sticky top-14 z-40" \/>/);
    assert.ok(!/aria-live="off"/.test(shell), 'the old role=status/aria-live=off banner must be gone');
  });
  test('LoginPage shows the inline label on all screen sizes', () => {
    const login = read('src/pages/LoginPage.jsx');
    assert.match(login, /import DemoBanner from '\.\.\/components\/common\/DemoBanner'/);
    assert.match(login, /<DemoBanner variant="inline"/);
  });
  test('PatientPortal labels both the verify gate and the authenticated portal', () => {
    const portal = read('src/pages/PatientPortal.jsx');
    assert.match(portal, /import DemoBanner from '\.\.\/components\/common\/DemoBanner'/);
    const count = (portal.match(/<DemoBanner/g) || []).length;
    assert.ok(count >= 2, `expected >= 2 DemoBanner usages in the portal, found ${count}`);
  });
});

describe('a11y-toast: notifications reach assistive tech', () => {
  const toast = read('src/components/common/Toast.jsx');
  test('container is a labeled polite live region', () => {
    assert.match(toast, /aria-live="polite"/);
    assert.match(toast, /aria-label="Notifications"/);
  });
  test('error/warning toasts escalate to role="alert"', () => {
    assert.match(toast, /const urgent = toast\.type === 'error' \|\| toast\.type === 'warning'/);
    assert.match(toast, /role=\{urgent \? 'alert' : 'status'\}/);
  });
});

describe('a11y-modal: dialog traps keyboard focus (WCAG 2.1.2 / 2.4.3)', () => {
  const modal = read('src/components/common/Modal.jsx');
  test('Tab / Shift+Tab cycle focus inside the dialog', () => {
    assert.match(modal, /e\.key !== 'Tab'/);
    assert.match(modal, /e\.shiftKey && document\.activeElement === first/);
    assert.match(modal, /document\.activeElement === last/);
  });
  test('Escape-to-close and aria-modal are preserved', () => {
    assert.match(modal, /e\.key === 'Escape'/);
    assert.match(modal, /aria-modal="true"/);
  });
});

describe('a11y-nav: skip link + current-page semantics', () => {
  const shell = read('src/components/layout/AppShell.jsx');
  test('a skip-to-content link targets the main landmark', () => {
    assert.match(shell, /href="#main-content"/);
    assert.match(shell, /Skip to main content/);
    assert.match(shell, /id="main-content"/);
  });
  test('active nav items expose aria-current="page"', () => {
    assert.match(shell, /aria-current=\{active \? 'page' : undefined\}/);
    assert.match(shell, /aria-current=\{isActiveNav\(item\.path\) \? 'page' : undefined\}/);
  });
});

describe('a11y-loading: LoadingSpinner announces as a status region', () => {
  const spinner = read('src/components/common/LoadingSpinner.jsx');
  test('role=status + aria-live present; decorative ring hidden', () => {
    assert.match(spinner, /role="status"/);
    assert.match(spinner, /aria-live="polite"/);
    assert.match(spinner, /aria-hidden="true"/);
  });
});

describe('a11y-motion: reduced-motion guard covers toast + skeleton', () => {
  const css = read('src/index.css');
  test('prefers-reduced-motion neutralizes non-essential animations', () => {
    const idx = css.indexOf('@media (prefers-reduced-motion: reduce)');
    assert.ok(idx !== -1, 'a prefers-reduced-motion block must exist');
    const block = css.slice(idx, css.indexOf('animation: none !important;', idx));
    assert.match(block, /\.toast-enter/);
    assert.match(block, /\.skeleton/);
  });
});

describe('honesty: ErrorBoundary no longer over-promises auto-save', () => {
  const app = read('src/App.jsx');
  test('the misleading blanket "Your work has been auto-saved." claim is gone', () => {
    assert.ok(!app.includes('Your work has been auto-saved.'), 'overbroad auto-save claim must be removed');
  });
  test('the replacement copy is honest about unsaved changes + is an alert', () => {
    assert.match(app, /unsaved changes on this screen may be lost/);
    assert.match(app, /role="alert"/);
  });
});
