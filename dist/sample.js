// An entirely invented practice card, generated locally without file or network input.
export function drawSample(canvas) {
  canvas.width = 960; canvas.height = 600;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffefa'; ctx.fillRect(0,0,960,600);
  ctx.fillStyle = '#294a38'; ctx.fillRect(0,0,960,100);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 28px sans-serif';
  ctx.fillText('SYNTHETIC SAMPLE / ERFUNDENES BEISPIEL',32,62);
  ctx.fillStyle = '#212a36'; ctx.font = '24px sans-serif';
  ctx.fillText('Name: Sample Person / Beispielperson',48,170);
  ctx.fillText('Reference / Referenz: DEMO-1042',48,230);
  ctx.fillStyle = '#e8ecde'; ctx.fillRect(48,280,864,230);
  ctx.fillStyle = '#212a36'; ctx.font = '22px sans-serif';
  ctx.fillText('1. Cover the invented name or reference.',72,330);
  ctx.fillText('2. Download and inspect the new PNG.',72,370);
  ctx.fillText('1. Erfundenen Namen oder Referenz verdecken.',72,430);
  ctx.fillText('2. Neues PNG herunterladen und prüfen.',72,470);
  ctx.font = '18px sans-serif';
  ctx.fillText('Practice only. No real personal data. / Keine echten persönlichen Daten.',48,560);
  return canvas;
}
