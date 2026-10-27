// Sharing is invoked only by a fresh user click, after image encoding finishes.
export function imageFile(blob, name, nav = navigator) {
  if (!blob || !blob.type.startsWith('image/') || !nav.share || !nav.canShare) return null;
  const file = new File([blob], name, {type: blob.type});
  try { return nav.canShare({files: [file]}) ? file : null; } catch { return null; }
}

export function mountImageSave(parent, report, nav = navigator) {
  const box = document.createElement('div');
  const button = document.createElement('button');
  const note = document.createElement('p');
  button.type = 'button'; button.className = 'button primary';
  box.hidden = true; note.className = 'hint'; box.append(button, note); parent.append(box);
  let file = null, revision = 0, sharing = false;
  const de = () => document.documentElement.lang === 'de';
  const copy = () => {
    button.textContent = de() ? 'Bild speichern oder teilen' : 'Save or share image';
    note.textContent = de() ? 'Auf dem iPhone im Teilen-Menü „Bild sichern“ wählen, falls angeboten. Der Download speichert eine Datei.' : 'On iPhone, choose “Save Image” in the share sheet if offered. Download saves a file.';
  };
  button.onclick = async () => {
    if (!file || sharing) return;
    const current = revision; sharing = true; button.disabled = true;
    try {
      await nav.share({files: [file]});
      if (current === revision) report(de() ? 'Teilen-Menü geschlossen. Prüfe das gewählte Ziel; Speichern in Fotos kann hier nicht bestätigt werden.' : 'Share sheet closed. Check your chosen destination; saving to Photos cannot be confirmed here.');
    } catch (error) {
      if (current === revision) report(error.name === 'AbortError'
        ? (de() ? 'Teilen abgebrochen. Du kannst es erneut versuchen oder die Datei herunterladen.' : 'Sharing cancelled. Try again or download the file.')
        : (de() ? 'Teilen nicht verfügbar. Verwende den Datei-Download.' : 'Sharing unavailable. Use the file download.'));
    } finally { sharing = false; button.disabled = false; }
  };
  return {
    clear() { revision++; file = null; box.hidden = true; },
    set(blob, name) { revision++; file = imageFile(blob, name, nav); copy(); box.hidden = !file; return Boolean(file); },
  };
}
