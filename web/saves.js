// Save banks only: ISO assets never enter localStorage.
(() => {
  const maxBytes = 262144;
  function key(game, bank) {
    if (!['jak1', 'jak2', 'jak3'].includes(game) || !Number.isInteger(bank) || bank < 0 || bank > 7)
      throw new Error('Banco de guardado no válido');
    return `jakompiled:saves:v1:${game}:${bank}`;
  }
  function report(kind, message) {
    console[kind === 'error' ? 'error' : 'info'](`[saves] ${message}`);
    window.dispatchEvent(new CustomEvent('jakompiled-save-status', {detail: {kind, message}}));
  }
  window.JakompiledSaveStorage = {
    load(game, bank, expectedSize) {
      const raw = localStorage.getItem(key(game, bank));
      if (raw === null) return null;
      const record = JSON.parse(raw);
      if (record.version !== 1 || typeof record.data !== 'string' || record.data.length > maxBytes * 2)
        throw new Error('El guardado local está dañado');
      const binary = atob(record.data);
      if (binary.length !== expectedSize || binary.length > maxBytes)
        throw new Error('El tamaño del guardado local no es válido');
      return Uint8Array.from(binary, c => c.charCodeAt(0));
    },
    save(game, bank, bytes) {
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > maxBytes)
        throw new Error('El tamaño del guardado no es válido');
      let binary = '';
      // Avoid spreading an entire bank onto the JavaScript call stack.
      for (const byte of bytes) binary += String.fromCharCode(byte);
      localStorage.setItem(key(game, bank), JSON.stringify({version: 1, data: btoa(binary)}));
      report('saved', 'Partida guardada en este navegador.');
    },
    error(message) { report('error', message); },
  };
})();
