'use strict';
// The phone as a home: haptics, installing to the home screen, working offline, coming back to life
// after the app was in the background.
(function () {
  const C = window.COSMOS;
  const ua = navigator.userAgent || '';
  const IOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const STANDALONE = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  C.device = { ios: IOS, standalone: STANDALONE };
  if (STANDALONE) document.documentElement.classList.add('standalone');

  // ------------------------------------------------------------------ haptics
  // Android: the Vibration API. iOS has none, but Safari 18+ ticks the Taptic Engine when a native
  // switch toggles, and clicking its label from a touch handler counts. Only ever called from your own
  // touches, never from something the universe does on its own.
  let iosSwitch = null;
  if (IOS) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  const PATTERNS = { tick: [8], tap: [12], thud: [22], bloom: [14, 40, 26], arrive: [10, 60, 10, 60, 30] };
  let lastBuzz = 0;
  C.haptics = { on: C.storage.get('haptics', true) };
  C.haptic = function (kind) {
    if (!C.haptics.on) return;
    const now = performance.now();
    if (now - lastBuzz < 45) return;
    lastBuzz = now;
    const pat = PATTERNS[kind] || PATTERNS.tap;
    if (navigator.vibrate) { try { navigator.vibrate(pat); } catch (e) {} return; }
    if (!iosSwitch) return;
    // a pattern on iOS = several switch flips, each one tick
    const n = Math.ceil(pat.length / 2);
    for (let i = 0; i < n; i++) {
      if (i === 0) iosSwitch.click();
      else setTimeout(() => iosSwitch.click(), pat.slice(0, i * 2).reduce((a, b) => a + b, 0));
    }
  };

  // ------------------------------------------------------------------ installing
  let deferred = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    const b = document.getElementById('bInstall');
    if (b) b.hidden = false;
  });
  C.install = async function () {
    if (deferred) {
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) {}
      deferred = null;
      const b = document.getElementById('bInstall');
      if (b) b.hidden = true;
      return 'prompted';
    }
    return IOS ? 'ios' : 'none';
  };
  // the one-time hint on an iPhone, shown by main.js once you've played for a while
  C.installHintDue = () => IOS && !STANDALONE && location.protocol === 'https:' && !C.storage.get('installHinted', false);
  C.installHinted = () => C.storage.set('installHinted', true);

  // ------------------------------------------------------------------ offline
  // Network first, so an update shows up on the next launch; the cache only answers when offline.
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/[?&]drive/.test(location.search)) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
