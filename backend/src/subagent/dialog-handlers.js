/** Auto-accept/dismiss native dialogs so Playwright does not hang silently. */
export function attachDialogHandlers(page) {
  if (!page || typeof page.on !== 'function') return;
  page.on('dialog', async dialog => {
    try {
      const type = dialog.type?.() || dialog.type || 'alert';
      const msg = dialog.message?.() || dialog.message || '';
      if (type === 'prompt') await dialog.accept('');
      else await dialog.accept();
      process.stderr.write(`[dialog] auto-${type}: ${String(msg).slice(0, 120)}\n`);
    } catch {
      try { await dialog.dismiss(); } catch { /* ignore */ }
    }
  });
}
