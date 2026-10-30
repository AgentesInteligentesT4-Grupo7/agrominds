/*
 * Funções dos layouts da AgroMinds: ícones do tempo e gráficos em SVG (sem bibliotecas de fora: a página vira
 * imagem sem acesso à rede). Cada layout chama desenhar(dados, modelo); aberto direto no navegador, usa o EXEMPLO.
 */

/** Texto seguro dentro do HTML. */
function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Número em português (vírgula) ou "–". */
function num(n, casas = 0) {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(casas).replace('.', ',') : '–';
}

/** Ícone do tempo (código da OMM usado pelo Open-Meteo), em SVG de `s` px. */
function icone(codigo, s = 48) {
  const c = Number(codigo ?? 1);
  const sol = (cx, cy, r) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f9a825"/>` +
    Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return `<line x1="${cx + Math.cos(a) * r * 1.35}" y1="${cy + Math.sin(a) * r * 1.35}" x2="${cx + Math.cos(a) * r * 1.75}" y2="${cy + Math.sin(a) * r * 1.75}" stroke="#f9a825" stroke-width="${r * 0.22}" stroke-linecap="round"/>`;
    }).join('');
  const nuvem = (cx, cy, w, cor = '#b0bec5') =>
    `<g fill="${cor}"><ellipse cx="${cx}" cy="${cy}" rx="${w * 0.5}" ry="${w * 0.22}"/><circle cx="${cx - w * 0.18}" cy="${cy - w * 0.12}" r="${w * 0.2}"/><circle cx="${cx + w * 0.1}" cy="${cy - w * 0.2}" r="${w * 0.26}"/></g>`;
  const gotas = (cx, cy, w) =>
    [-0.25, 0, 0.25].map((d) => `<line x1="${cx + d * w}" y1="${cy}" x2="${cx + d * w - w * 0.08}" y2="${cy + w * 0.28}" stroke="#1e88e5" stroke-width="${w * 0.06}" stroke-linecap="round"/>`).join('');
  const x = 50;
  const y = 50;
  const t = 100;
  let corpo;
  if (c === 0) corpo = sol(x, y, t * 0.24);
  else if (c <= 2) corpo = sol(x - t * 0.15, y - t * 0.12, t * 0.2) + nuvem(x + t * 0.08, y + t * 0.12, t * 0.72, '#cfd8dc');
  else if (c === 3) corpo = nuvem(x, y + 6, t * 0.86);
  else if (c === 45 || c === 48) corpo = [0, 1, 2].map((i) => `<line x1="${x - 36}" y1="${y - 14 + i * 16}" x2="${x + 36}" y2="${y - 14 + i * 16}" stroke="#90a4ae" stroke-width="7" stroke-linecap="round"/>`).join('');
  else if (c >= 95) corpo = nuvem(x, y - 8, t * 0.86, '#78909c') + `<polygon points="${x},${y + 2} ${x - 12},${y + 30} ${x + 1},${y + 28} ${x - 6},${y + 48} ${x + 16},${y + 18} ${x + 3},${y + 20}" fill="#fdd835"/>`;
  else corpo = nuvem(x, y - 8, t * 0.86, '#90a4ae') + gotas(x, y + 12, t);
  return `<svg width="${s}" height="${s}" viewBox="0 0 100 100" aria-hidden="true">${corpo}</svg>`;
}

/**
 * Gráfico de linha (temperatura) com barras (chuva) num SVG de largura `w` × altura `h`.
 * pontos: [{ rotulo, temperatura, chuva, probabilidade? }]; `marcarCada`: rótulo a cada N pontos.
 */
function graficoTempoChuva(pontos, { w = 660, h = 200, marcarCada = 3 } = {}) {
  if (pontos.length < 2) return '';
  const m = { e: 34, d: 34, t: 22, b: 26 };
  const temps = pontos.map((p) => Number(p.temperatura ?? 0));
  const chuvas = pontos.map((p) => Number(p.chuva ?? 0));
  const tMin = Math.floor(Math.min(...temps) - 1);
  const tMax = Math.ceil(Math.max(...temps) + 1);
  const cMax = Math.max(4, ...chuvas);
  const lw = w - m.e - m.d;
  const lh = h - m.t - m.b;
  const px = (i) => m.e + (i / (pontos.length - 1)) * lw;
  const pyT = (t) => m.t + lh - ((t - tMin) / (tMax - tMin || 1)) * lh;
  const bw = Math.max(3, Math.min(16, (lw / pontos.length) * 0.6));
  const partes = [];
  for (let k = 0; k <= 3; k++) {
    const y = m.t + (lh * k) / 3;
    partes.push(`<line x1="${m.e}" y1="${y}" x2="${w - m.d}" y2="${y}" stroke="#eceee6"/>`);
    partes.push(`<text x="${m.e - 6}" y="${y + 4}" font-size="11" fill="#8a8d84" text-anchor="end">${Math.round(tMax - ((tMax - tMin) * k) / 3)}°</text>`);
    partes.push(`<text x="${w - m.d + 6}" y="${y + 4}" font-size="11" fill="#1e88e5">${num(cMax - (cMax * k) / 3, cMax < 10 ? 1 : 0)}</text>`);
  }
  chuvas.forEach((c, i) => {
    if (c <= 0) return;
    const bh = (c / cMax) * lh;
    partes.push(`<rect x="${px(i) - bw / 2}" y="${m.t + lh - bh}" width="${bw}" height="${bh}" rx="2" fill="#90caf9"/>`);
  });
  const caminho = temps.map((t, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${pyT(t).toFixed(1)}`).join(' ');
  partes.push(`<path d="${caminho} L${px(temps.length - 1)},${m.t + lh} L${px(0)},${m.t + lh} Z" fill="rgba(216,67,21,0.08)"/>`);
  partes.push(`<path d="${caminho}" fill="none" stroke="#d84315" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
  pontos.forEach((p, i) => {
    if (i % marcarCada !== 0) return;
    partes.push(`<circle cx="${px(i)}" cy="${pyT(temps[i])}" r="3.5" fill="#d84315"/>`);
    partes.push(`<text x="${px(i)}" y="${pyT(temps[i]) - 8}" font-size="12" fill="#bf360c" text-anchor="middle" font-weight="600">${num(temps[i])}°</text>`);
    partes.push(`<text x="${px(i)}" y="${h - 6}" font-size="12" fill="#5f6358" text-anchor="middle">${esc(p.rotulo)}</text>`);
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${partes.join('')}</svg>`;
}

/** Faixa mín–máx por dia (barra vertical) com a chuva embaixo; dias: [{ nome, max, min, chuva }]. */
function graficoDias(dias, { w = 660, h = 230 } = {}) {
  if (!dias.length) return '';
  const m = { e: 34, d: 14, t: 26, b: 92 };
  const lw = w - m.e - m.d;
  const lh = h - m.t - m.b;
  const tMin = Math.floor(Math.min(...dias.map((d) => d.min ?? 0)) - 1);
  const tMax = Math.ceil(Math.max(...dias.map((d) => d.max ?? 0)) + 1);
  const cMax = Math.max(5, ...dias.map((d) => d.chuva ?? 0));
  const passo = lw / dias.length;
  const py = (t) => m.t + lh - ((t - tMin) / (tMax - tMin || 1)) * lh;
  const partes = [];
  for (let k = 0; k <= 3; k++) {
    const y = m.t + (lh * k) / 3;
    partes.push(`<line x1="${m.e}" y1="${y}" x2="${w - m.d}" y2="${y}" stroke="#eceee6"/>`);
    partes.push(`<text x="${m.e - 6}" y="${y + 4}" font-size="11" fill="#8a8d84" text-anchor="end">${Math.round(tMax - ((tMax - tMin) * k) / 3)}°</text>`);
  }
  dias.forEach((d, i) => {
    const cx = m.e + passo * (i + 0.5);
    const bw = Math.min(26, passo * 0.45);
    const y1 = py(d.max);
    const y2 = py(d.min);
    partes.push(`<rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(4, y2 - y1)}" rx="${bw / 2}" fill="url(#gradTemp)"/>`);
    partes.push(`<text x="${cx}" y="${y1 - 6}" font-size="12" fill="#d84315" text-anchor="middle" font-weight="700">${num(d.max)}°</text>`);
    partes.push(`<text x="${cx}" y="${y2 + 15}" font-size="12" fill="#1565c0" text-anchor="middle">${num(d.min)}°</text>`);
    const ch = ((d.chuva ?? 0) / cMax) * 30;
    if ((d.chuva ?? 0) > 0) partes.push(`<rect x="${cx - bw / 2}" y="${h - 40 - ch}" width="${bw}" height="${ch}" rx="3" fill="#90caf9"/>`);
    partes.push(`<text x="${cx}" y="${h - 26}" font-size="11" fill="#1e88e5" text-anchor="middle">${(d.chuva ?? 0) > 0 ? num(d.chuva, d.chuva < 10 ? 1 : 0) + ' mm' : ''}</text>`);
    partes.push(`<text x="${cx}" y="${h - 8}" font-size="12" fill="#3d4038" text-anchor="middle" font-weight="600">${esc(d.nome)}</text>`);
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="gradTemp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7043"/><stop offset="1" stop-color="#42a5f5"/></linearGradient></defs>${partes.join('')}</svg>`;
}

/** Monta a página: `modelo(dados)` devolve o HTML de dentro do <main>. */
function desenhar(dados, modelo) {
  document.getElementById('app').innerHTML = modelo(dados);
}
