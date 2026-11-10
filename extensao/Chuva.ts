import { type Previsao, horaLocal, somarHoras } from './OpenMeteo.js';

/**
 * Chuva hora a hora (Open-Meteo): junta as horas seguidas com chuva prevista em janelas ("das 15h às 18h"). No
 * Open-Meteo, `precipitation` e `precipitation_probability` de uma hora valem para a hora ANTERIOR (o valor das 16h é
 * a chuva entre 15h e 16h); por isso a janela começa uma hora antes do primeiro valor. É previsão de modelo: a hora
 * pode adiantar ou atrasar; para a próxima hora, o radar (Radar.ts) mostra a chuva chegando.
 */
export interface JanelaDeChuva {
  /** "2026-11-09T15:00" (local): começo e fim da janela. */
  inicio: string;
  fim: string;
  mm: number;
  /** Maior probabilidade numa hora da janela (null se o modelo não deu). */
  probabilidade: number | null;
  /** Hora de mais chuva (começo do intervalo de 1 h) e quanto. */
  pico: string;
  picoMm: number;
  intensidade: 'fraca' | 'moderada' | 'forte';
}

/** Hora com chuva: pelo menos 0,2 mm no modelo, ou 50% de chance. */
const MIN_MM = 0.2;
const MIN_PROB = 50;

export function janelasDeChuva(p: Previsao, agora: Date, horas = 48): JanelaDeChuva[] {
  const local = horaLocal(agora, p.utcOffsetSeconds);
  // O valor da próxima hora cheia já cobre o intervalo em que estamos.
  const de = somarHoras(local, 1);
  const ate = somarHoras(local, horas);
  const h = p.horas;
  const janelas: JanelaDeChuva[] = [];
  let atual: JanelaDeChuva | undefined;
  h.time.forEach((t, i) => {
    if (t < de || t > ate) return;
    const mm = Number(h.precipitation?.[i] ?? 0) || 0;
    const prob = h.precipitation_probability?.[i];
    const chove = mm >= MIN_MM || (typeof prob === 'number' && prob >= MIN_PROB);
    const comeco = somarHoras(t, -1);
    if (!chove) {
      atual = undefined;
      return;
    }
    if (!atual) {
      atual = { inicio: comeco, fim: t, mm: 0, probabilidade: null, pico: comeco, picoMm: -1, intensidade: 'fraca' };
      janelas.push(atual);
    }
    atual.fim = t;
    atual.mm += mm;
    if (typeof prob === 'number') atual.probabilidade = Math.max(atual.probabilidade ?? 0, prob);
    if (mm > atual.picoMm) Object.assign(atual, { pico: comeco, picoMm: mm });
  });
  for (const j of janelas) {
    j.mm = Math.round(j.mm * 10) / 10;
    j.picoMm = Math.max(0, j.picoMm);
    j.intensidade = j.picoMm >= 10 ? 'forte' : j.picoMm >= 2.5 ? 'moderada' : 'fraca';
  }
  return janelas;
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function nomeDoDia(dia: string, hoje: string): string {
  if (dia === hoje) return 'Hoje';
  if (dia === somarHoras(`${hoje}T00:00`, 24).slice(0, 10)) return 'Amanhã';
  const nome = DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()]!;
  return `${nome[0]!.toUpperCase()}${nome.slice(1)} (${dia.slice(8, 10)}/${dia.slice(5, 7)})`;
}

const hora = (t: string) => `${Number(t.slice(11, 13))}h`;
const mm = (v: number) => (v < 1 ? v.toFixed(1) : String(Math.round(v))).replace('.', ',');

function chance(prob: number | null): string {
  if (prob === null) return 'prevista';
  if (prob >= 60) return `provável (até ${prob}%)`;
  if (prob >= 30) return `possível (até ${prob}%)`;
  return `pouco provável (até ${prob}%)`;
}

/** Texto para o agente e para quem não recebe imagem. */
export function textoChuvaPorHora(p: Previsao, lugar: string, agora: Date, horas = 48): string {
  const janelas = janelasDeChuva(p, agora, horas);
  const hoje = horaLocal(agora, p.utcOffsetSeconds).slice(0, 10);
  const linhas = [`🌧️ Chuva hora a hora · ${lugar} · próximas ${horas} h`];
  if (!janelas.length) linhas.push('Sem chuva prevista nessas horas.');
  for (const j of janelas) {
    const dia = nomeDoDia(j.inicio.slice(0, 10), hoje);
    const pico = j.fim > somarHoras(j.inicio, 1) ? `, mais forte entre ${hora(j.pico)} e ${hora(somarHoras(j.pico, 1))}` : '';
    linhas.push(`• ${dia}: das ${hora(j.inicio)} às ${hora(j.fim)} — ${chance(j.probabilidade)}, ~${mm(j.mm)} mm (${j.intensidade})${pico}`);
  }
  linhas.push(
    'É previsão de modelo, hora a hora: o começo pode adiantar ou atrasar 1 a 2 h. Quando a chuva estiver perto, o radar mostra se ela está chegando.',
  );
  if (p.desatualizada) linhas.push('(Última previsão guardada: o serviço não respondeu agora.)');
  return linhas.join('\n');
}
