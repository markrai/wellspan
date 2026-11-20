const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function labelImageError(file) {
  if (typeof Blob === 'undefined' || !(file instanceof Blob) || !IMAGE_TYPES.has(file.type) ||
    file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    return 'Select a PNG, JPEG or WebP image between 1 byte and 5 MiB.';
  }
  return null;
}

function clipboardImages(items) {
  return Array.from(items || [])
    .filter(item => item?.kind === 'file' && item.type?.startsWith('image/'))
    .map(item => item.getAsFile?.()).filter(Boolean);
}

function createLabelImageInput({ dialog, photo, preview, dropZone, browse, paste, fileName, notify, beforeReplace }) {
  let image = null;
  let previewUrl = null;
  let version = 0;

  function clear() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    image = null;
    preview.removeAttribute('src');
    preview.hidden = true;
    fileName.textContent = 'No image selected';
    dropZone.classList.remove('is-dragging');
  }

  function select(file, method) {
    version++;
    beforeReplace();
    clear();
    if (method !== 'browse') photo.value = '';
    if (!file) {
      notify('Select one nutrition label image.');
      return;
    }
    const error = labelImageError(file);
    if (error) {
      photo.value = '';
      notify(error);
      return;
    }
    try {
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      preview.hidden = false;
      image = file;
    } catch {
      clear();
      notify('Could not preview the selected image.');
      return;
    }
    fileName.textContent = typeof file.name === 'string' && file.name.trim() ? file.name : 'Clipboard image';
    notify('Image ready. Compare the original label before applying values.');
  }

  photo.addEventListener('change', () => select(photo.files?.[0], 'browse'));
  browse.addEventListener('click', () => photo.click());
  dropZone.addEventListener('keydown', event => {
    if (event.target === dropZone && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      photo.click();
    }
  });

  const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  dropZone.addEventListener('dragenter', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
  dropZone.addEventListener('dragover', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    dropZone.classList.add('is-dragging');
  });
  dropZone.addEventListener('dragleave', event => {
    if (!event.relatedTarget || !dropZone.contains(event.relatedTarget)) dropZone.classList.remove('is-dragging');
  });
  dropZone.addEventListener('drop', event => {
    dropZone.classList.remove('is-dragging');
    if (!isFileDrag(event)) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length !== 1) {
      select(null, 'drop');
      notify('Drop exactly one PNG, JPEG or WebP image.');
      return;
    }
    select(files[0], 'drop');
  });

  dialog.addEventListener('paste', event => {
    if (!dialog.open || event.defaultPrevented ||
      event.target?.closest?.('input:not([type="file"]), textarea, [contenteditable]')) return;
    const images = clipboardImages(event.clipboardData?.items);
    if (!images.length) return;
    event.preventDefault();
    if (images.length !== 1) {
      notify('Paste exactly one image.');
      return;
    }
    select(images[0], 'clipboard');
  });

  paste.addEventListener('click', async () => {
    const pendingVersion = version;
    if (typeof navigator.clipboard?.read !== 'function') {
      notify('Clipboard image access is unavailable. Focus the drop area and press Ctrl+V / ⌘V, or choose a file.');
      dropZone.focus();
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const images = items.flatMap(item => Array.from(item.types || [])
        .filter(type => type.startsWith('image/')).map(type => ({ item, type })));
      if (pendingVersion !== version || !dialog.open) return;
      if (images.length !== 1) {
        notify('Copy one image or screenshot to the clipboard, then try again.');
        return;
      }
      const file = await images[0].item.getType(images[0].type);
      if (pendingVersion === version && dialog.open) select(file, 'clipboard');
    } catch {
      if (pendingVersion === version && dialog.open) {
        notify('Could not read an image from the clipboard. Focus the drop area and press Ctrl+V / ⌘V, or choose a file.');
      }
    }
  });

  return {
    get image() { return image; },
    reset() {
      version++;
      clear();
      photo.value = '';
    }
  };
}

export { labelImageError, clipboardImages, createLabelImageInput };
