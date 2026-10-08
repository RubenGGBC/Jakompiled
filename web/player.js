// CSS scales the displayed canvas; the renderer retains control of its buffer.
(() => {
  const player = document.getElementById('player');
  const button = document.getElementById('fullscreen');
  const error = document.getElementById('player-error');
  const display = new URLSearchParams(location.search).get('display') === '1';
  player.hidden = !display;
  button.hidden = !display || !document.fullscreenEnabled;
  function update() {
    const active = document.fullscreenElement === player;
    button.textContent = active ? 'Salir de pantalla completa' : 'Pantalla completa';
    button.setAttribute('aria-label', button.textContent);
  }
  button.addEventListener('click', async () => {
    error.hidden = true;
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen();
      else await player.requestFullscreen();
      update();
      // Return keyboard control to the game after activating the button.
      button.blur();
    } catch (e) {
      error.textContent = 'No se pudo cambiar la pantalla completa. Inténtalo de nuevo.';
      error.hidden = false;
      console.warn('[player] fullscreen:', e);
    }
  });
  document.addEventListener('fullscreenchange', update);
  update();
})();
