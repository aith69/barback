import { t } from '/shared/i18n.js';
import { api } from '/shared/api.js';
import { h } from '/shared/dom.js';

let unlocked = false;

// Resolves once this browser has a PIN session. If not, shows the PIN form inside `container`.
export async function requirePin(container) {
  if (unlocked) return;
  if ((await api('GET', '/api/auth/status')).authenticated) {
    unlocked = true;
    return;
  }
  await new Promise((resolve) => {
    const input = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: 64, required: true });
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
