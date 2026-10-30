import type { Lavoura, Lugar } from './Banco.js';
import type { Cultura } from './Regras.js';
import type { Manejo, Zarc } from './Zarc.js';

export interface Epoca {
  nome?: string;
  /** Culturas do ZARC (Nome_cultura) desta época; várias = junta (ex.: banana prata, maçã e cavendish). */
  culturas: string[];
}

export interface Planta {
  id: string;
  nome: string;
  grupo: 'lavoura' | 'horta';
  /** Cultura de regras/culturas.yaml (fases e Kc). */
  cultura: string;
  zarc: Epoca[];
  perene: boolean;
  /** Ciclo médio (referência a revisar): só para estimar fase e colheita de quem informou a data de plantio. */
  cicloDias?: number;
}

export const GRUPOS: Record<Planta['grupo'], string> = { lavoura: '🚜 Lavoura, pasto e café', horta: '🥬 Horta, quintal e pomar' };
export const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Lê `regras/plantas.yaml`. */
export function lerPlantas(raw: unknown): Planta[] {
  const doc = raw as { plantas?: Record<string, { nome: string; grupo?: string; cultura?: string; zarc?: Epoca[]; perene?: boolean; ciclo_dias?: number }> };
  return Object.entries(doc.plantas ?? {}).map(([id, p]) => {
    if (!p?.nome || !p.cultura) throw new Error(`planta "${id}" sem nome ou cultura`);
    return {
      id,
      nome: p.nome,
      grupo: p.grupo === 'lavoura' ? 'lavoura' : 'horta',
      cultura: p.cultura,
      zarc: (p.zarc ?? []).map((e) => ({ ...(e.nome ? { nome: String(e.nome) } : {}), culturas: (e.culturas ?? []).map(String) })),
      perene: p.perene === true,
      ...(typeof p.ciclo_dias === 'number' ? { cicloDias: p.ciclo_dias } : {}),
    };
  });
}

/** Todas as culturas do ZARC que o catálogo usa (o que importar da tábua). */
export function culturasDoZarc(plantas: Planta[]): Set<string> {
  return new Set(plantas.flatMap((p) => p.zarc.flatMap((e) => e.culturas)));
}

// ------------------------------------------------------------------ decêndios (1 a 36: 3 por mês)

/** Decêndio (1–36) de uma data AAAA-MM-DD. */
export function decendioDe(data: string): number {
  const mes = Number(data.slice(5, 7));
  const dia = Number(data.slice(8, 10));
  return (mes - 1) * 3 + (dia <= 10 ? 1 : dia <= 20 ? 2 : 3);
}

function ultimoDia(mes: number): number {
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]!;
}

/** "21/set" (início) ou "30/set" (fim) de um decêndio. */
export function diaDoDecendio(d: number, fim = false): string {
  const mes = Math.ceil(d / 3);
  const parte = (d - 1) % 3;
  const dia = fim ? (parte === 0 ? 10 : parte === 1 ? 20 : ultimoDia(mes)) : parte * 10 + 1;
  return `${dia}/${MESES[mes - 1]}`;
}

export interface Faixa {
  /** Decêndios de início e fim (o fim pode ser menor que o início: a faixa vira o ano). */
  inicio: number;
  fim: number;
  /** Maior risco dentro da faixa (20, 30 ou 40%). */
  risco: number;
}

/** Decêndios indicados seguidos viram faixas; a que cruza o fim do ano (dez → jan) fica numa só. */
export function faixas(risco: number[]): Faixa[] {
  if (risco.every((r) => r > 0)) return [{ inicio: 1, fim: 36, risco: Math.max(...risco) }];
  // Começa num decêndio não indicado: assim a faixa que vira o ano não se parte.
  const partida = risco.findIndex((r) => r === 0);
  const out: Faixa[] = [];
  let atual: Faixa | undefined;
  for (let k = 1; k <= 36; k++) {
    const i = (partida + k) % 36;
    const r = risco[i]!;
    if (r > 0) {
      if (atual) {
        atual.fim = i + 1;
        atual.risco = Math.max(atual.risco, r);
      } else atual = { inicio: i + 1, fim: i + 1, risco: r };
    } else if (atual) {
      out.push(atual);
      atual = undefined;
    }
  }
  if (atual) out.push(atual);
  return out;
}

export function textoFaixa(f: Faixa): string {
  if (f.inicio === 1 && f.fim === 36) return 'o ano todo';
  return `${diaDoDecendio(f.inicio)} a ${diaDoDecendio(f.fim, true)}`;
}

/** Decêndios até a próxima abertura da janela (0 = aberta agora; undefined = nunca). */
export function decendiosAte(risco: number[], hoje: number): number | undefined {
  for (let k = 0; k < 36; k++) if (risco[(hoje - 1 + k) % 36]! > 0) return k;
  return undefined;
}

// ------------------------------------------------------------------ fase pela data de plantio

/** Fases pelo ciclo: até 12% inicial, 45% vegetativo, 60% florescimento, 85% enchimento; depois, colheita. */
const PELO_CICLO: Array<[number, string]> = [
  [0.12, 'inicial'],
  [0.45, 'vegetativo'],
  [0.6, 'florescimento'],
  [0.85, 'enchimento'],
  [Infinity, 'colheita'],
];

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate.slice(0, 10)}T12:00:00Z`) - Date.parse(`${de.slice(0, 10)}T12:00:00Z`)) / 86400_000);
}

export function somarDias(data: string, dias: number): string {
  return new Date(Date.parse(`${data.slice(0, 10)}T12:00:00Z`) + dias * 86400_000).toISOString().slice(0, 10);
}

export interface FaseAtual {
  fase: string;
  /** Dias desde o plantio (quando informado). */
  dias?: number;
  /** Colheita estimada (plantio + ciclo médio), AAAA-MM-DD. */
  colheita?: string;
  /** Passou bem do ciclo: provavelmente já colheu. */
  passou?: boolean;
}

/** Fase de hoje: pela data de plantio e o ciclo, quando há os dois; senão, a que a pessoa informou. */
export function faseAtual(l: Lavoura, planta: Planta | undefined, cultura: Cultura | undefined, hoje: string): FaseAtual {
  if (!l.plantio || !planta?.cicloDias || planta.perene) return { fase: l.fase };
  const dias = diasEntre(l.plantio, hoje);
  const colheita = somarDias(l.plantio, planta.cicloDias);
  if (dias < 0) return { fase: cultura?.fases.preparo ? 'preparo' : l.fase, dias, colheita };
  const fase = PELO_CICLO.find(([limite]) => dias / planta.cicloDias! < limite)![1];
  return { fase: cultura?.fases[fase] ? fase : l.fase, dias, colheita, ...(dias > planta.cicloDias * 1.3 ? { passou: true } : {}) };
}

/** As plantas da pessoa com a fase de hoje (é o que as regras avaliam). */
export function lavourasAtuais(lavouras: Lavoura[], plantas: Planta[], culturas: Cultura[], hoje: string): Lavoura[] {
  return lavouras.map((l) => {
    const planta = plantas.find((p) => p.id === l.planta);
    return { ...l, fase: faseAtual(l, planta, culturas.find((c) => c.id === l.cultura), hoje).fase };
  });
}

export function nomeDaPlanta(id: string, plantas: Planta[], culturas: Cultura[] = []): string {
  return plantas.find((p) => p.id === id)?.nome ?? culturas.find((c) => c.id === id)?.nome ?? id;
}

/** "soja (florindo), milho (crescendo, irrigada) e mais 2" — para cabeçalhos e legendas. */
export function resumoPlantas(lavouras: Lavoura[], plantas: Planta[], culturas: Cultura[], max = 3): string {
  const partes = lavouras.map((l) => {
    const fase = culturas.find((c) => c.id === l.cultura)?.fases[l.fase]?.nome;
    const extras = [fase?.toLowerCase(), l.irrigada ? 'irrigada' : ''].filter(Boolean).join(', ');
    return `${nomeDaPlanta(l.planta, plantas, culturas).toLowerCase()}${extras ? ` (${extras})` : ''}`;
  });
  if (partes.length <= max) return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}` : (partes[0] ?? '');
  return `${partes.slice(0, max).join(', ')} e mais ${partes.length - max}`;
}

// ------------------------------------------------------------------ calendário do município (ZARC)

/** Município do lugar (cidade "Goiânia/GO") na tábua do ZARC; sem nome de cidade (só coordenada) ou fora dela, nada. */
export function municipioDoLugar(zarc: Zarc, lugar: Lugar): { geocodigo: string; nome: string; uf: string } | undefined {
  const [cidade, uf] = lugar.cidade.split('/');
  if (!cidade || /^-?\d/.test(cidade)) return undefined;
  return zarc.municipio(cidade.trim(), (uf ?? lugar.uf)?.trim() || null);
}

export interface LinhaCalendario {
  planta: string;
  nome: string;
  epoca?: string;
  /** 36 decêndios: risco 20/30/40 onde o ZARC indica plantar; 0 onde não indica. */
  risco: number[];
  manejo?: string;
  /** A planta não tem zoneamento (folhosas, temperos), o município não tem janela para ela ou ela nem está no catálogo. */
  semDado?: 'sem_zoneamento' | 'nao_indicado' | 'fora_do_catalogo';
  /** A pessoa pediu esta planta (entra a mais na tabela). */
  pedida?: boolean;
  /** É uma planta da pessoa (destaque) e, com a data de plantio, de quando até quando (colheita estimada). */
  minha?: boolean;
  plantio?: string;
  colheita?: string;
}

/** Linhas do calendário (uma por época) para as plantas pedidas, no município. */
export function calendario(zarc: Zarc, geocodigo: string | undefined, plantas: Planta[], minhas: Lavoura[] = []): LinhaCalendario[] {
  const out: LinhaCalendario[] = [];
  for (const p of plantas) {
    const minha = minhas.find((l) => l.planta === p.id);
    const base = { planta: p.id, nome: p.nome, ...(minha ? { minha: true } : {}) };
    const sua = minha?.plantio ? { plantio: minha.plantio, ...(p.cicloDias ? { colheita: somarDias(minha.plantio, p.cicloDias) } : {}) } : {};
    if (!p.zarc.length) {
      out.push({ ...base, ...sua, risco: new Array(36).fill(0), semDado: 'sem_zoneamento' });
      continue;
    }
    const manejo: Manejo = minha?.irrigada ? 'Irrigado' : 'Sequeiro';
    p.zarc.forEach((epoca, i) => {
      const janelas = geocodigo ? zarc.janelas(geocodigo, epoca.culturas, { manejo }) : [];
      const risco = new Array<number>(36).fill(0);
      for (const j of janelas) j.risco.forEach((r, k) => r && (!risco[k] || r < risco[k]!) && (risco[k] = r));
      out.push({
        ...base,
        ...(i === 0 ? sua : {}),
        ...(epoca.nome ? { epoca: epoca.nome } : {}),
        risco,
        ...(janelas[0] ? { manejo: janelas[0].manejo } : {}),
        ...(janelas.some((j) => j.risco.some(Boolean)) ? {} : { semDado: 'nao_indicado' as const }),
      });
    });
  }
  return out;
}

/** O que dá para plantar agora (janela aberta no decêndio de hoje) e o que abre nas próximas ~4 semanas. */
export function sugestoes(linhas: LinhaCalendario[], hoje: string): { agora: LinhaCalendario[]; logo: Array<LinhaCalendario & { em: number }> } {
  const d = decendioDe(hoje);
  const comDado = linhas.filter((l) => !l.semDado);
  return {
    agora: comDado.filter((l) => l.risco[d - 1]! > 0),
    logo: comDado
      .filter((l) => !l.risco[d - 1])
      .map((l) => ({ ...l, em: decendiosAte(l.risco, d) ?? 99 }))
      .filter((l) => l.em <= 3)
      .sort((a, b) => a.em - b.em),
  };
}

/** Texto do calendário (para a legenda e para o agente): "Soja: plantio de 21/set a 10/jan (risco até 40%)". */
export function textoCalendario(linhas: LinhaCalendario[]): string[] {
  return linhas.map((l) => {
    const nome = `${l.nome}${l.epoca ? ` (${l.epoca})` : ''}${l.pedida ? ' [você pediu]' : ''}`;
    if (l.semDado === 'fora_do_catalogo') return `${nome}: não está no catálogo do bot, sem dado oficial de época de plantio`;
    if (l.semDado === 'sem_zoneamento') return `${nome}: o ZARC não tem zoneamento para esta planta`;
    if (l.semDado === 'nao_indicado') return `${nome}: o ZARC não indica plantio no seu município`;
    const fx = faixas(l.risco).map((f) => `${textoFaixa(f)}${f.risco > 20 ? ` (risco até ${f.risco}%)` : ''}`);
    return `${nome}: plantar de ${fx.join('; ')}${l.manejo === 'Irrigado' ? ', com irrigação' : ''}`;
  });
}
