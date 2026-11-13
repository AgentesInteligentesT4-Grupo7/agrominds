import type { Anotacao, TipoAnotacao } from './Banco.js';
import { somarDias } from './Plantas.js';

/** Caderno de campo: o que a pessoa fez na roça (aplicação, adubação, irrigação, colheita...), anotado pela conversa. */
export const TIPOS: Record<TipoAnotacao, string> = {
  aplicacao: 'Aplicação',
  adubacao: 'Adubação',
  irrigacao: 'Irrigação',
  plantio: 'Plantio',
  colheita: 'Colheita',
  chuva: 'Chuva medida',
  observacao: 'Observação',
  outro: 'Outro',
};

export const ehTipo = (v: unknown): v is TipoAnotacao => typeof v === 'string' && v in TIPOS;

/**
 * O dia que a pessoa disse ("hoje", "ontem", "anteontem", "2026-11-08", "8/11") em AAAA-MM-DD. Dia no futuro ou de
 * mais de um ano atrás: undefined.
 */
export function diaDe(texto: unknown, hoje: string): string | undefined {
  const t = String(texto ?? 'hoje').trim().toLowerCase();
  let dia: string | undefined;
  if (!t || t === 'hoje') dia = hoje;
  else if (t === 'ontem') dia = somarDias(hoje, -1);
  else if (t === 'anteontem') dia = somarDias(hoje, -2);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) dia = t;
  else {
    const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
    if (m) {
      const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : hoje.slice(0, 4);
      dia = `${ano}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
      // "28/12" dito em janeiro é do ano passado.
      if (!m[3] && dia > hoje) dia = `${Number(ano) - 1}${dia.slice(4)}`;
    }
  }
  if (!dia || Number.isNaN(Date.parse(`${dia}T12:00:00Z`)) || dia > hoje || dia < somarDias(hoje, -366)) return undefined;
  return dia;
}

const dm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const num = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',');

export function linhaDaAnotacao(a: Anotacao, nomeDaPlanta: (id: string) => string): string {
  const planta = a.planta ? ` · ${nomeDaPlanta(a.planta)}` : '';
  const qtd = a.quantidade !== null ? ` (${num(a.quantidade)}${a.unidade ? ` ${a.unidade}` : ''})` : '';
  return `• ${dm(a.dia)} · ${TIPOS[a.tipo]}${planta} · ${a.texto}${qtd}`;
}

/** Lista do caderno com um resumo: quantas anotações de cada tipo e o total colhido por planta e unidade. */
export function textoCaderno(anotacoes: Anotacao[], lugar: string, dias: number, nomeDaPlanta: (id: string) => string): string {
  if (!anotacoes.length) return `📒 Caderno de campo · ${lugar}: nada anotado nos últimos ${dias} dias.`;
  const linhas = [`📒 Caderno de campo · ${lugar} · últimos ${dias} dias (${anotacoes.length} ${anotacoes.length === 1 ? 'anotação' : 'anotações'})`];
  linhas.push(...anotacoes.slice(0, 30).map((a) => linhaDaAnotacao(a, nomeDaPlanta)));
  if (anotacoes.length > 30) linhas.push(`… e mais ${anotacoes.length - 30} anotações antigas.`);
  const contagem = new Map<TipoAnotacao, number>();
  const colhido = new Map<string, number>();
  for (const a of anotacoes) {
    contagem.set(a.tipo, (contagem.get(a.tipo) ?? 0) + 1);
    if (a.tipo === 'colheita' && a.quantidade !== null) {
      const chave = `${a.planta ? nomeDaPlanta(a.planta) : 'sem planta'}|${a.unidade ?? ''}`;
      colhido.set(chave, (colhido.get(chave) ?? 0) + a.quantidade);
    }
  }
  linhas.push(`Resumo: ${[...contagem].map(([t, q]) => `${TIPOS[t].toLowerCase()} ${q}`).join(', ')}.`);
  if (colhido.size) {
    linhas.push(`Colhido no período: ${[...colhido].map(([k, q]) => { const [planta, unidade] = k.split('|'); return `${planta} ${num(q)}${unidade ? ` ${unidade}` : ''}`; }).join('; ')}.`);
  }
  return linhas.join('\n');
}

/**
 * Texto da mensagem em forma de fala: sem emoji nem marcadores, unidades por extenso, horas como se fala.
 * Corta em ~1.500 caracteres, no fim de uma frase.
 */
export function paraFala(texto: string): string {
  let t = texto
    .replace(/\s*\(regra em revisão\)/g, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/\s*[•·]\s*/g, ', ')
    .replace(/(\d+)[,.](\d+)\s*mm\b/g, '$1 vírgula $2 milímetros')
    .replace(/(\d)\s*mm\b/g, '$1 milímetros')
    .replace(/(\d)\s*km\/h\b/g, '$1 quilômetros por hora')
    .replace(/(\d)\s*°C/g, '$1 graus')
    .replace(/(\d)\s*%/g, '$1 por cento')
    .replace(/(\d{1,2})h(\d{2})\b/g, '$1 e $2')
    .replace(/(\d{1,2})h\b/g, '$1 horas')
    .replace(/(\d)\s*[–-]\s*(\d)/g, '$1 a $2')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/([.!?:;])\s*[,.]+/g, '$1')
    .replace(/^\s*[,.]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (t.length > 1500) {
    const corte = t.lastIndexOf('. ', 1500);
    t = t.slice(0, corte > 600 ? corte + 1 : 1500);
  }
  return t;
}
