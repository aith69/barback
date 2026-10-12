import { t } from '/shared/i18n.js';
import { api } from '/shared/api.js';
import { h } from '/shared/dom.js';

let unlocked = false;

// A text field shows the numeric keypad on every phone (password fields often do not).
// The digits are masked by CSS; if the browser cannot, fall back to a password field.
const canMask = typeof CSS !== 'undefined' && CSS.supports('-webkit-text-security', 'disc');

// Resolves once this browser has a PIN session. If not, shows the PIN form inside `container`.
export async function requirePin(container) {
  if (unlocked) return;
  if ((await api('GET', '/api/auth/status')).authenticated) {
    unlocked = true;
    return;
  }
  await new Promise((resolve) => {
    const input = h('input', {
      type: canMask ? 'text' : 'password',
      class: canMask ? 'masked' : '',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      enterkeyhint: 'go',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      maxlength: 64,
      required: true,
    });
    const message = h('p', { class: 'error' });
    const form = h('form', {
      class: 'pin',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('POST', '/api/auth/login', { pin: input.value });
          unlocked = true;
          resolve();
        } catch (err) {
          message.textContent = err.status === 429 ? t('pin.locked') : t('pin.wrong');
          input.value = '';
          input.focus();
        }
      },
    }, h('h2', {}, t('pin.title')), input, h('button', { type: 'submit' }, t('pin.unlock')), message);
    container.replaceChildren(form);
    input.focus();
  });
}
