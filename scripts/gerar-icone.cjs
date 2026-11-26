// Gera build/icon.png (512), build/icon.ico (16–256) e src/renderer/public/icon.png a partir do SVG abaixo.
// Uso: npx electron scripts/gerar-icone.cjs
const { app, BrowserWindow, nativeImage } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#1b2550"/><stop offset="1" stop-color="#05070f"/></radialGradient>
    <radialGradient id="pl" cx="34%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".15" stop-color="#7af0db"/><stop offset=".55" stop-color="#36e2c4"/><stop offset="1" stop-color="#4a3fb0"/></radialGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="10"/></filter>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="none" stroke="#36e2c4" stroke-opacity=".35" stroke-width="6"/>
  <g fill="#fff"><circle cx="110" cy="120" r="4"/><circle cx="400" cy="100" r="3"/><circle cx="420" cy="380" r="4"/><circle cx="90" cy="390" r="3"/><circle cx="380" cy="200" r="2.5"/></g>
  <ellipse cx="256" cy="268" rx="200" ry="58" transform="rotate(-18 256 268)" fill="none" stroke="#ffb347" stroke-width="18" stroke-opacity=".55"/>
  <circle cx="256" cy="262" r="122" fill="#36e2c4" opacity=".35" filter="url(#glow)"/>
  <circle cx="256" cy="262" r="118" fill="url(#pl)"/>
  <path d="M 62 330 A 200 58 0 0 0 450 206" transform="rotate(-18 256 268) rotate(18 256 268)" fill="none"/>
  <clipPath id="front"><rect x="0" y="268" width="512" height="300" transform="rotate(-18 256 268)"/></clipPath>
  <ellipse cx="256" cy="268" rx="200" ry="58" transform="rotate(-18 256 268)" fill="none" stroke="#ffb347" stroke-width="18" clip-path="url(#front)"/>
  <circle cx="418" cy="150" r="20" fill="#a594ff"/>
</svg>`;

function ico(pngs) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length); let off = 6 + dir.length;
  pngs.forEach(([size, buf], i) => {
    const o = i * 16; dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(off, o + 12); off += buf.length;
  });
  return Buffer.concat([head, dir, ...pngs.map(p => p[1])]);
}

app.whenReady().then(async () => {
  const root = join(__dirname, '..');
  const render = async size => {
    const w = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
    w.webContents.setZoomFactor(1);
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden">${SVG.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`));
    await new Promise(r => setTimeout(r, 300));
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    w.destroy();
    return img.resize({ width: size, height: size, quality: 'best' }).toPNG();
  };
  const big = await render(512);
  writeFileSync(join(root, 'build', 'icon.png'), big);
  writeFileSync(join(root, 'src', 'renderer', 'public', 'icon.png'), big);
  // Tamanhos menores: reduz a imagem grande (janelas minúsculas não renderizam bem fora da tela).
  const base = nativeImage.createFromBuffer(big);
  const pngs = [16, 24, 32, 48, 64, 128, 256].map(s => [s, base.resize({ width: s, height: s, quality: 'best' }).toPNG()]);
  writeFileSync(join(root, 'build', 'icon.ico'), ico(pngs));
  console.log('ícones gerados');
  app.quit();
});
