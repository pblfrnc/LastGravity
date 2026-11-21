// Tema claro/escuro/sistema. Aplica no <html data-theme>, no editor (Monaco) e expõe a aba "Aparência".
(() => {
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const resolve = (mode) => (mode === 'system' ? (media.matches ? 'light' : 'dark') : mode === 'light' ? 'light' : 'dark');
  let mode = new URLSearchParams(location.search).get('theme') || 'dark';

  const MONACO = {
    dark: { base: 'vs-dark', colors: { 'editor.background': '#0f1117', 'editor.lineHighlightBackground': '#161922', 'editorGutter.background': '#0f1117', 'editorLineNumber.foreground': '#4b5165', 'editor.selectionBackground': '#264f78', 'minimap.background': '#0f1117', 'scrollbarSlider.background': '#2a2f3f88', 'diffEditor.insertedTextBackground': '#34d39926', 'diffEditor.removedTextBackground': '#f8717126' } },
    light: { base: 'vs', colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f6f7f9', 'editorGutter.background': '#ffffff', 'editorLineNumber.foreground': '#a0a7b4', 'editor.selectionBackground': '#cfe0ff', 'minimap.background': '#ffffff', 'scrollbarSlider.background': '#cfd4db88', 'diffEditor.insertedTextBackground': '#16a34a22', 'diffEditor.removedTextBackground': '#dc262622' } },
  };
  function applyMonaco(t) {
    const m = window.monaco;
    if (!m) return false;
    // Redefine o tema usado pelo app ("lastgravity"), assim editores criados depois já nascem certos.
    m.editor.defineTheme('lastgravity', { base: MONACO[t].base, inherit: true, rules: [], colors: MONACO[t].colors });
    m.editor.setTheme('lastgravity');
    return true;
  }
  function apply(next = mode) {
    mode = next;
    const t = resolve(mode);
    document.documentElement.dataset.theme = t;
    const again = () => { setTimeout(() => applyMonaco(resolve(mode)), 600); setTimeout(() => applyMonaco(resolve(mode)), 2500); };
    if (applyMonaco(t)) again();
    else {
      const iv = setInterval(() => { if (applyMonaco(resolve(mode))) { clearInterval(iv); again(); } }, 300);
      setTimeout(() => clearInterval(iv), 30000);
    }
  }
  apply(mode);
  media.addEventListener('change', () => { if (mode === 'system') apply('system'); });

  // Preferência salva na configuração (a porta do servidor muda a cada abertura, então não usamos localStorage).
  const fromConfig = () => { const c = window.LG?.getConfig?.(); return c?.appearance?.theme; };
  const iv = setInterval(() => { const t = fromConfig(); if (t) { clearInterval(iv); if (t !== mode) apply(t); } }, 200);
  setTimeout(() => clearInterval(iv), 15000);

  // Aba "Aparência" nas Configurações (com prévia ao vivo; Cancelar volta ao tema salvo).
  function register() {
    if (!window.LG?.registerSettingsTab) return setTimeout(register, 100);
    window.LG.registerSettingsTab({
      id: 'appearance', label: 'Aparência', icon: '◐', order: 11,
      render(el, draft, ctx) {
        draft.appearance = { theme: 'dark', ...(draft.appearance || {}) };
        const cur = draft.appearance.theme;
        const card = (v, title, desc, swatch) => `<label class="radio-card ${cur === v ? 'sel' : ''}"><input type="radio" name="lg-theme" value="${v}" ${cur === v ? 'checked' : ''}><span class="swatch ${swatch}"></span><b>${title}</b><span>${desc}</span></label>`;
        el.innerHTML = `<h3>Aparência</h3>
          <h4>Tema</h4>
          <div class="radio-cards">
            ${card('dark', 'Escuro', 'Fundo escuro, ideal à noite e para longas sessões.', 'sw-dark')}
            ${card('light', 'Claro', 'Fundo claro, melhor em ambientes iluminados.', 'sw-light')}
            ${card('system', 'Sistema', 'Segue o modo claro/escuro do macOS automaticamente.', 'sw-system')}
          </div>
          <p class="muted">A mudança aparece na hora. Clique em Salvar para manter.</p>`;
        el.querySelectorAll('input[name=lg-theme]').forEach((r) => r.addEventListener('change', () => {
          draft.appearance.theme = r.value;
          ctx.markDirty();
          apply(r.value);
          ctx.rerender();
        }));
      },
    });
    const dlg = document.getElementById('dlg-settings');
    dlg?.addEventListener('close', () => setTimeout(() => apply(fromConfig() || 'dark'), 50));
  }
  register();

  const style = document.createElement('style');
  style.textContent = `.radio-card .swatch{display:block;height:44px;border-radius:8px;border:1px solid var(--line);margin-bottom:4px}
.sw-dark{background:linear-gradient(90deg,#0f1117 0 30%,#161922 30% 100%)}
.sw-light{background:linear-gradient(90deg,#ffffff 0 30%,#f6f7f9 30% 100%)}
.sw-system{background:linear-gradient(90deg,#0f1117 0 50%,#ffffff 50% 100%)}`;
  document.head.appendChild(style);
  window.LGTheme = { apply, get mode() { return mode; } };
})();
