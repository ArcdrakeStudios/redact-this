export function region(x1, y1, x2, y2, width, height) {
  if (![x1, y1, x2, y2, width, height].every(Number.isFinite)) {
    throw new Error('Use finite pixel coordinates.');
  }
  const left = Math.max(0, Math.floor(Math.min(x1, x2)));
  const top = Math.max(0, Math.floor(Math.min(y1, y2)));
  const right = Math.min(width, Math.ceil(Math.max(x1, x2)));
  const bottom = Math.min(height, Math.ceil(Math.max(y1, y2)));
  if (right <= left || bottom <= top) throw new Error('Choose a region inside the image with a positive width and height.');
  return {x: left, y: top, width: right - left, height: bottom - top};
}

export function paint(canvas, bitmap, regions) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable in this browser.');
  context.drawImage(bitmap, 0, 0);
  context.fillStyle = '#000000';
  for (const r of regions) context.fillRect(r.x, r.y, r.width, r.height);
  return canvas;
}

export function encode(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob || blob.type !== 'image/png') reject(new Error('The browser could not encode a PNG. Try a smaller image.'));
      else resolve(blob);
    }, 'image/png');
  });
}
