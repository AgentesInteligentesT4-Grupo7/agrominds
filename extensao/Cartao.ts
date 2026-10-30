import type { Lavoura, Lugar } from './Banco.js';
import type { FitaApi, TelegramResposta } from './k7.js';
import { type Previsao, horaLocal, somarHoras } from './OpenMeteo.js';
import { type Cultura, type Resultado, quandoLegivel } from './Regras.js';

const L = 960;
const A = 640;
const FONTE = "Segoe UI, Roboto, Arial, sans-serif";
const COR_SEV = { grave: '#c62828', atencao: '#b26a00', info: '#1565c0' } as const;

function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const num = (n: unknown, casas = 0) => (typeof n === 'number' ? n.toFixed(casas).replace('.', ',') : '–');

/** Ícone do tempo desenhado em SVG (código da OMM), centrado em (x, y), com o tamanho `s`. */
export function icone(codigo: number | null | undefined, x: number, y: number, s: number): string {
  const c = Number(codigo ?? 1);
  const sol = (cx: number, cy: number, r: number) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f9a825"/>` +
    Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return `<line x1="${cx + Math.cos(a) * r * 1.35}" y1="${cy + Math.sin(a) * r * 1.35}" x2="${cx + Math.cos(a) * r * 1.75}" y2="${cy + Math.sin(a) * r * 1.75}" stroke="#f9a825" stroke-width="${r * 0.22}" stroke-linecap="round"/>`;
    }).join('');
  const nuvem = (cx: number, cy: number, w: number, cor = '#b0bec5') =>
    `<g fill="${cor}"><ellipse cx="${cx}" cy="${cy}" rx="${w * 0.5}" ry="${w * 0.22}"/><circle cx="${cx - w * 0.18}" cy="${cy - w * 0.12}" r="${w * 0.2}"/><circle cx="${cx + w * 0.1}" cy="${cy - w * 0.2}" r="${w * 0.26}"/></g>`;
  const gotas = (cx: number, cy: number, w: number) =>
    [-0.25, 0, 0.25].map((d) => `<line x1="${cx + d * w}" y1="${cy}" x2="${cx + d * w - w * 0.08}" y2="${cy + w * 0.28}" stroke="#1e88e5" stroke-width="${w * 0.06}" stroke-linecap="round"/>`).join('');
  if (c === 0) return sol(x, y, s * 0.28);
  if (c <= 2) return sol(x - s * 0.15, y - s * 0.12, s * 0.22) + nuvem(x + s * 0.08, y + s * 0.12, s * 0.75, '#cfd8dc');
  if (c === 3) return nuvem(x, y, s * 0.9);
  if (c === 45 || c === 48) return [0, 1, 2].map((i) => `<line x1="${x - s * 0.4}" y1="${y - s * 0.15 + i * s * 0.17}" x2="${x + s * 0.4}" y2="${y - s * 0.15 + i * s * 0.17}" stroke="#90a4ae" stroke-width="${s * 0.07}" stroke-linecap="round"/>`).join('');
  if (c >= 95) return nuvem(x, y - s * 0.1, s * 0.9, '#78909c') + `<polygon points="${x},${y + s * 0.02} ${x - s * 0.12},${y + s * 0.3} ${x + s * 0.01},${y + s * 0.28} ${x - s * 0.06},${y + s * 0.5} ${x + s * 0.16},${y + s * 0.18} ${x + s * 0.03},${y + s * 0.2}" fill="#fdd835"/>`;
  return nuvem(x, y - s * 0.1, s * 0.9, '#90a4ae') + gotas(x, y + s * 0.12, s);
}

function descricao(codigo: number | null | undefined): string {
  const c = Number(codigo ?? -1);
  if (c === 0) return 'Céu limpo';
  if (c <= 2) return 'Poucas nuvens';
  if (c === 3) return 'Nublado';
  if (c === 45 || c === 48) return 'Nevoeiro';
  if (c >= 51 && c <= 57) return 'Garoa';
  if (c >= 61 && c <= 67) return 'Chuva';
  if (c >= 80 && c <= 82) return 'Pancadas de chuva';
  if (c >= 95) return 'Trovoada';
  return '';
}

/**
 * Cartão do tempo (SVG 960×640) para mandar como foto no Telegram: agora, próximos 4 dias, gráfico das próximas
 * 24 h (temperatura e chuva) e os avisos das regras. Só desenho vetorial e texto: vira PNG pelo `k7.util.svgParaPng`.
 */
export function cartaoSvg(p: Previsao, lugar: Lugar, lavoura: Lavoura | undefined, culturas: Cultura[], resultados: Resultado[], titulo: string, agora = new Date()): string {
  const local = horaLocal(agora, p.utcOffsetSeconds);
  const hoje = local.slice(0, 10);
  const a = p.atual;
  const cultura = culturas.find((c) => c.id === lavoura?.cultura);
  const fase = cultura?.fases[lavoura?.fase ?? '']?.nome;
  const quando = `${quandoLegivel(`${local.slice(0, 10)}T12:00`, local).replace(/ às 12h$/, '')}, ${local.slice(8, 10)}/${local.slice(5, 7)} às ${Number(local.slice(11, 13))}h`;
  const d = p.dias;
  const iHoje = d.time.indexOf(hoje);
  const chuvaHoje = iHoje >= 0 ? d.precipitation_sum?.[iHoje] : null;

  const partes: string[] = [];
  partes.push(`<rect width="${L}" height="${A}" rx="28" fill="#f6f7f2"/>`);
  // Cabeçalho
  partes.push(`<rect width="${L}" height="104" rx="28" fill="#2e7d32"/><rect y="76" width="${L}" height="28" fill="#2e7d32"/>`);
  partes.push(`<text x="36" y="48" font-size="30" font-weight="700" fill="#fff">${esc(titulo)} · ${esc(lugar.nome)}</text>`);
  partes.push(`<text x="36" y="84" font-size="20" fill="#c8e6c9">${esc(quando[0]!.toUpperCase() + quando.slice(1))}${cultura ? ` · ${esc(cultura.nome)}${fase ? ` (${esc(fase.toLowerCase())})` : ''}${lavoura?.irrigada ? ', irrigada' : ''}` : ''}</text>`);
  partes.push(`<text x="${L - 36}" y="48" font-size="26" font-weight="700" fill="#fff" text-anchor="end">AgroMinds</text>`);

  // Agora
  partes.push(`<rect x="24" y="124" width="380" height="200" rx="20" fill="#fff" stroke="#e0e3d7"/>`);
  partes.push(icone(a.weather_code as number, 104, 210, 120));
  partes.push(`<text x="190" y="225" font-size="72" font-weight="300" fill="#1d1f1a">${num(a.temperature_2m)}°</text>`);
  partes.push(`<text x="190" y="258" font-size="20" fill="#5f6358">${esc(descricao(a.weather_code as number))}</text>`);
  partes.push(`<text x="48" y="290" font-size="18" fill="#3d4038">Umidade ${num(a.relative_humidity_2m)}% · Vento ${num(a.wind_speed_10m)} km/h</text>`);
  partes.push(`<text x="48" y="314" font-size="18" fill="#1565c0">Chuva prevista hoje: ${num(chuvaHoje, 1)} mm</text>`);

  // Próximos 4 dias
  const dias = d.time.flatMap((t, i) => (t >= hoje ? [i] : [])).slice(0, 4);
  dias.forEach((i, k) => {
    const x = 424 + k * 130;
    const nome = quandoLegivel(`${d.time[i]}T12:00`, local).replace(/ às 12h$/, '');
    partes.push(`<rect x="${x}" y="124" width="118" height="200" rx="18" fill="#fff" stroke="#e0e3d7"/>`);
    partes.push(`<text x="${x + 59}" y="156" font-size="18" font-weight="600" fill="#1d1f1a" text-anchor="middle">${esc(nome[0]!.toUpperCase() + nome.slice(1, 9))}</text>`);
    // Ícone do dia: chuva se a chance passar de 50%, senão sol/nuvem pela máxima de nebulosidade não disponível → pela chuva.
    const prob = Number(d.precipitation_probability_max?.[i] ?? 0);
    const codigo = prob >= 70 ? 63 : prob >= 40 ? 80 : 2;
    partes.push(icone(codigo, x + 59, 205, 70));
    partes.push(`<text x="${x + 59}" y="268" font-size="22" text-anchor="middle"><tspan fill="#d84315" font-weight="600">${num(d.temperature_2m_max?.[i])}°</tspan><tspan fill="#5f6358"> / ${num(d.temperature_2m_min?.[i])}°</tspan></text>`);
    partes.push(`<text x="${x + 59}" y="300" font-size="16" fill="#1565c0" text-anchor="middle">${num(d.precipitation_sum?.[i], 1)} mm · ${num(prob)}%</text>`);
  });

  // Próximas 24 h: temperatura (linha) e chuva (barras)
  const gx = 24;
  const gy = 344;
  const gw = L - 48;
  const gh = 170;
  partes.push(`<rect x="${gx}" y="${gy}" width="${gw}" height="${gh + 40}" rx="20" fill="#fff" stroke="#e0e3d7"/>`);
  partes.push(`<text x="${gx + 20}" y="${gy + 28}" font-size="17" font-weight="600" fill="#1d1f1a">Próximas 24 horas</text>`);
  const lx = gx + gw - 290;
  partes.push(`<line x1="${lx}" y1="${gy + 22}" x2="${lx + 26}" y2="${gy + 22}" stroke="#d84315" stroke-width="3.5"/><text x="${lx + 34}" y="${gy + 28}" font-size="15" fill="#5f6358">temperatura</text>`);
  partes.push(`<rect x="${lx + 150}" y="${gy + 14}" width="12" height="16" rx="2" fill="#90caf9"/><text x="${lx + 170}" y="${gy + 28}" font-size="15" fill="#5f6358">chuva (mm/h)</text>`);
  const h = p.horas;
  const idx = h.time.flatMap((t, i) => (t >= local && t < somarHoras(local, 24) ? [i] : []));
  if (idx.length > 1) {
    const temps = idx.map((i) => Number(h.temperature_2m?.[i] ?? 0));
    const chuvas = idx.map((i) => Number(h.precipitation?.[i] ?? 0));
    const tMin = Math.min(...temps) - 1;
    const tMax = Math.max(...temps) + 1;
    const cMax = Math.max(4, ...chuvas);
    const x0 = gx + 50;
    const largura = gw - 80;
    const topo = gy + 48;
    const altura = gh - 40;
    const px = (k: number) => x0 + (k / (idx.length - 1)) * largura;
    const pyT = (t: number) => topo + altura - ((t - tMin) / (tMax - tMin)) * altura;
    chuvas.forEach((c, k) => {
      if (c <= 0) return;
      const bh = (c / cMax) * altura;
      partes.push(`<rect x="${px(k) - 7}" y="${topo + altura - bh}" width="14" height="${bh}" rx="3" fill="#90caf9"/>`);
      if (c >= 1) partes.push(`<text x="${px(k)}" y="${topo + altura - bh - 4}" font-size="12" fill="#1565c0" text-anchor="middle">${num(c, 1)}</text>`);
    });
    partes.push(`<polyline points="${temps.map((t, k) => `${px(k).toFixed(1)},${pyT(t).toFixed(1)}`).join(' ')}" fill="none" stroke="#d84315" stroke-width="3.5" stroke-linejoin="round"/>`);
    temps.forEach((t, k) => {
      const hora = Number(h.time[idx[k]!]!.slice(11, 13));
      if (k % 3 !== 0) return;
      partes.push(`<circle cx="${px(k)}" cy="${pyT(t)}" r="4" fill="#d84315"/>`);
      partes.push(`<text x="${px(k)}" y="${pyT(t) - 10}" font-size="14" fill="#bf360c" text-anchor="middle">${num(t)}°</text>`);
      partes.push(`<text x="${px(k)}" y="${topo + altura + 24}" font-size="14" fill="#5f6358" text-anchor="middle">${hora}h</text>`);
    });
  }

  // Avisos (no máximo 3, os mais sérios primeiro)
  const peso = { grave: 0, atencao: 1, info: 2 };
  const avisos = [...resultados].filter((r) => r.alerta).sort((x, y) => peso[x.severidade] - peso[y.severidade]).slice(0, 3);
  const ay = gy + gh + 56;
  if (!avisos.length) {
    partes.push(`<rect x="24" y="${ay}" width="${gw}" height="46" rx="14" fill="#e8f5e9"/><text x="44" y="${ay + 30}" font-size="18" fill="#2e7d32">Sem alertas de risco para as próximas horas.</text>`);
  } else {
    const w = (gw - (avisos.length - 1) * 12) / avisos.length;
    avisos.forEach((r, k) => {
      const x = 24 + k * (w + 12);
      partes.push(`<rect x="${x}" y="${ay}" width="${w}" height="46" rx="14" fill="${COR_SEV[r.severidade]}"/>`);
      partes.push(`<text x="${x + 18}" y="${ay + 30}" font-size="18" font-weight="600" fill="#fff">${r.severidade === 'grave' ? 'GRAVE: ' : 'Atenção: '}${esc(r.titulo)}</text>`);
    });
  }
  partes.push(`<text x="${L - 30}" y="${A - 12}" font-size="13" fill="#8a8d84" text-anchor="end">Dados: Open-Meteo.com · regras em revisão por agrônomo(a)</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${A}" viewBox="0 0 ${L} ${A}" font-family="${FONTE}">${partes.join('')}</svg>`;
}

/**
 * Mensagem com o cartão como foto (o texto vai de legenda). Desligado (AGRO_CARTAO=off) ou se a imagem falhar,
 * manda só o texto.
 */
export async function comCartao(k7: FitaApi, texto: string, svg: () => string): Promise<string | TelegramResposta> {
  if (k7.fita.env.AGRO_CARTAO === 'off') return texto;
  try {
    return { texto, imagem: await k7.util.svgParaPng(svg()) };
  } catch (error) {
    k7.log.aviso(`Cartão do tempo não gerado (${error instanceof Error ? error.message : String(error)}); vai só o texto`);
    return texto;
  }
}
