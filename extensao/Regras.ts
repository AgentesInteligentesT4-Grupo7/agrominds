import type { Lavoura, Severidade } from './Banco.js';
import { type Previsao, horaLocal, somarHoras } from './OpenMeteo.js';

type Operador = '<' | '<=' | '>' | '>=' | '==';

interface Condicao {
  variavel: string;
  agregacao?: 'minimo' | 'maximo' | 'soma' | 'media' | 'horas';
  janela?: string;
  operador: Operador;
  valor: number;
  /** Para `horas`: quantas horas precisam atender `operador valor`. */
  minimo_horas?: number;
}

export interface Regra {
  id: string;
  tipo?: 'alerta' | 'janela' | 'balanco' | 'radar';
  titulo: string;
  culturas?: string[] | 'todas';
  fases?: string[] | 'todas';
  quando?: Condicao[];
  qualquer?: Condicao[];
  severidade?: Severidade;
  grave_se?: { operador: Operador; valor: number };
  fases_grave?: string[];
  mensagem?: string;
  // janela
  janela?: string;
  apenas_dia?: boolean;
  condicoes_hora?: Condicao[];
  mensagem_com?: string;
  mensagem_sem?: string;
  // balanço
  apenas_irrigadas?: boolean;
  dias?: number;
  limite_mm?: number;
  chuva_prevista_dias?: number;
  mensagem_irrigar?: string;
  mensagem_esperar?: string;
  mensagem_ok?: string;
  // radar (aviso automático de chuva chegando; o motor de regras ignora, quem usa é o Notificador)
  minutos?: number;
  dbz_minimo?: number;
  grave_dbz?: number;
  fonte?: string;
  revisado_por?: string | null;
}

export interface Cultura {
  id: string;
  nome: string;
  fases: Record<string, { nome: string; kc: number }>;
}

/** O que uma regra concluiu para uma lavoura agora. */
export interface Resultado {
  regra: string;
  titulo: string;
  severidade: Severidade;
  texto: string;
  /** Dia a que o aviso se refere (para não repetir o mesmo aviso). */
  dia: string;
  /** É aviso de risco (vai fora do boletim) ou recomendação do dia (só no boletim e no /clima). */
  alerta: boolean;
  /** Plantas a que o aviso se refere (regras de cultura ou fase); ausente nos avisos gerais do tempo. */
  plantas?: string[];
}

/** Chave para não repetir o mesmo aviso: regra, plantas e dia. */
export function chaveDe(r: Resultado): string {
  return `${r.regra}${r.plantas?.length ? `@${r.plantas.join('+')}` : ''}:${r.dia}`;
}

/** Regra que vale para qualquer planta (geada, chuva, vento...): sai uma vez só, mesmo com várias plantas. */
function geral(r: Regra): boolean {
  return (r.tipo ?? 'alerta') !== 'balanco' && (!r.culturas || r.culturas === 'todas') && (!r.fases || r.fases === 'todas');
}

const PESO_SEV: Record<Severidade, number> = { info: 0, atencao: 1, grave: 2 };

/**
 * Avalia as regras para todas as plantas da pessoa. Os avisos gerais saem uma vez (com a severidade mais alta entre
 * as plantas: geada é grave para quem está florindo); os de cultura ou fase dizem a que plantas se referem, e o
 * mesmo aviso para várias plantas vira um só ("Soja e milho · ...").
 */
export function avaliarTodas(
  regras: Regra[],
  p: Previsao,
  lavouras: Lavoura[],
  culturas: Cultura[],
  nomes: (l: Lavoura) => string,
  agora = new Date(),
  chuvaMedida: (lugarId: number) => Record<string, number> = () => ({}),
): Resultado[] {
  if (!lavouras.length) return avaliarRegras(regras, p, undefined, culturas, agora);
  const gerais = new Map<string, Resultado>();
  const especificos = new Map<string, { r: Resultado; lavouras: Lavoura[] }>();
  for (const l of lavouras) {
    for (const r of avaliarRegras(regras, p, l, culturas, agora, chuvaMedida(l.lugarId))) {
      const regra = regras.find((x) => x.id === r.regra);
      if (regra && geral(regra)) {
        const atual = gerais.get(r.regra);
        if (!atual || PESO_SEV[r.severidade] > PESO_SEV[atual.severidade]) gerais.set(r.regra, r);
        continue;
      }
      const chave = `${r.regra}|${r.dia}|${r.texto}`;
      const junto = especificos.get(chave);
      if (junto) junto.lavouras.push(l);
      else especificos.set(chave, { r, lavouras: [l] });
    }
  }
  const unico = lavouras.length === 1;
  return [
    ...gerais.values(),
    ...[...especificos.values()].map(({ r, lavouras: ls }) => {
      const nomesTxt = ls.map(nomes).join(', ').replace(/, ([^,]*)$/, ' e $1');
      return { ...r, plantas: ls.map((l) => l.planta), texto: unico ? r.texto : `${nomesTxt} · ${r.texto}` };
    }),
  ];
}

/** Lê `regras/culturas.yaml`: cada cultura herda as fases padrão e muda só as que lista. */
export function lerCulturas(raw: unknown): Cultura[] {
  const doc = raw as { fases_padrao?: Cultura['fases']; culturas?: Record<string, { nome: string; so_estas_fases?: boolean; fases?: Cultura['fases'] }> };
  return Object.entries(doc.culturas ?? {}).map(([id, c]) => ({
    id,
    nome: c.nome,
    fases: c.so_estas_fases ? { ...(c.fases ?? {}) } : { ...(doc.fases_padrao ?? {}), ...(c.fases ?? {}) },
  }));
}

export function lerRegras(raw: unknown): Regra[] {
  if (!Array.isArray(raw)) throw new Error('regras/clima.yaml deve ser uma lista de regras');
  return raw.map((r: Regra) => {
    if (!r?.id || !r.titulo) throw new Error(`regra sem id ou título: ${JSON.stringify(r).slice(0, 80)}`);
    return r;
  });
}

/** Série hora a hora com as derivadas (Delta T, molhamento, chuva nas 2 h seguintes). */
export interface Serie {
  time: string[];
  get(variavel: string, i: number): number | null;
}

export function serie(p: Previsao): Serie {
  const h = p.horas;
  const cache = new Map<string, Array<number | null>>();
  const base = (v: string) => (h[v] as Array<number | null> | undefined) ?? [];
  const derivada = (v: string): Array<number | null> => {
    if (cache.has(v)) return cache.get(v)!;
    const t = base('temperature_2m');
    const rh = base('relative_humidity_2m');
    const chuva = base('precipitation');
    let out: Array<number | null>;
    if (v === 'delta_t') out = t.map((temp, i) => (temp === null || rh[i] == null ? null : round(temp - bulboUmido(temp, rh[i]!), 1)));
    else if (v === 'molhamento') out = rh.map((u, i) => (u === null ? null : u >= 90 || (chuva[i] ?? 0) > 0.1 ? 1 : 0));
    else if (v === 'chuva_proximas_2h') out = chuva.map((_, i) => round((chuva[i] ?? 0) + (chuva[i + 1] ?? 0) + (chuva[i + 2] ?? 0), 1));
    else out = base(v);
    cache.set(v, out);
    return out;
  };
  return { time: h.time, get: (v, i) => derivada(v)[i] ?? null };
}

/** Bulbo úmido (fórmula de Stull, 2011), em °C, a partir da temperatura e da umidade relativa. */
export function bulboUmido(t: number, rh: number): number {
  return t * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(t + rh) - Math.atan(rh - 1.676331) + 0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) - 4.686035;
}

/** Índices das horas de uma janela ("proximas_36h", "ultimas_24h", "hoje", "amanha"). */
export function indicesDaJanela(janela: string, time: string[], agoraLocal: string): number[] {
  const hoje = agoraLocal.slice(0, 10);
  const amanha = somarHoras(`${hoje}T12:00`, 24).slice(0, 10);
  let filtro: (h: string) => boolean;
  const proximas = /^proximas_(\d+)h$/.exec(janela);
  const ultimas = /^ultimas_(\d+)h$/.exec(janela);
  if (proximas) {
    const fim = somarHoras(agoraLocal, Number(proximas[1]));
    filtro = (h) => h >= agoraLocal && h < fim;
  } else if (ultimas) {
    const inicio = somarHoras(agoraLocal, -Number(ultimas[1]));
    filtro = (h) => h >= inicio && h < agoraLocal;
  } else if (janela === 'hoje') filtro = (h) => h.startsWith(hoje);
  else if (janela === 'amanha') filtro = (h) => h.startsWith(amanha);
  else throw new Error(`janela desconhecida: ${janela}`);
  return time.flatMap((h, i) => (filtro(h) ? [i] : []));
}

function compara(a: number, op: Operador, b: number): boolean {
  return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : a === b;
}

/** Calcula a condição: o valor agregado, se ela vale e a hora do extremo (para "{quando}"). */
function avaliar(c: Condicao, s: Serie, agoraLocal: string): { valor: number; ok: boolean; hora: string | null } {
  const idx = indicesDaJanela(c.janela ?? 'proximas_24h', s.time, agoraLocal).filter((i) => s.get(c.variavel, i) !== null);
  if (!idx.length) return { valor: NaN, ok: false, hora: null };
  const valores = idx.map((i) => s.get(c.variavel, i)!);
  const agg = c.agregacao ?? 'maximo';
  if (agg === 'horas') {
    const n = valores.filter((v) => compara(v, c.operador, c.valor)).length;
    return { valor: n, ok: n >= (c.minimo_horas ?? 1), hora: null };
  }
  let valor: number;
  let hora: string | null = null;
  if (agg === 'minimo' || agg === 'maximo') {
    const alvo = agg === 'minimo' ? Math.min(...valores) : Math.max(...valores);
    valor = alvo;
    hora = s.time[idx[valores.indexOf(alvo)]!]!;
  } else if (agg === 'soma') valor = valores.reduce((a, b) => a + b, 0);
  else valor = valores.reduce((a, b) => a + b, 0) / valores.length;
  return { valor: round(valor, 1), ok: compara(round(valor, 1), c.operador, c.valor), hora };
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "sexta às 5h" (ou "hoje às 5h", "amanhã às 5h") a partir da hora local. */
export function quandoLegivel(hora: string, agoraLocal: string): string {
  const dia = hora.slice(0, 10);
  const h = Number(hora.slice(11, 13));
  const hoje = agoraLocal.slice(0, 10);
  const amanha = somarHoras(`${hoje}T12:00`, 24).slice(0, 10);
  const nome = dia === hoje ? 'hoje' : dia === amanha ? 'amanhã' : DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()]!;
  return `${nome} às ${h}h`;
}

function aplica(lista: string[] | 'todas' | undefined, valor: string): boolean {
  return !lista || lista === 'todas' || lista.includes(valor);
}

export function formatar(texto: string, vars: Record<string, string | number>): string {
  return texto.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]).replace('.', ',') : m));
}

/**
 * Avalia todas as regras para uma lavoura (ou só as gerais, sem lavoura cadastrada) com a previsão do lugar.
 * Regra sem `revisado_por` sai marcada "(regra em revisão)". `chuvaMedida`: o pluviômetro da pessoa ({ dia: mm }),
 * que vale no lugar da estimativa do modelo no balanço de água.
 */
export function avaliarRegras(regras: Regra[], p: Previsao, lavoura: Lavoura | undefined, culturas: Cultura[], agora = new Date(), chuvaMedida: Record<string, number> = {}): Resultado[] {
  const s = serie(p);
  const agoraLocal = horaLocal(agora, p.utcOffsetSeconds);
  const hoje = agoraLocal.slice(0, 10);
  const cultura = culturas.find((c) => c.id === lavoura?.cultura);
  const faseNome = cultura?.fases[lavoura?.fase ?? '']?.nome ?? lavoura?.fase ?? '';
  const out: Resultado[] = [];
  for (const r of regras) {
    if (lavoura && (!aplica(r.culturas, lavoura.cultura) || !aplica(r.fases, lavoura.fase))) continue;
    if (!lavoura && ((r.fases && r.fases !== 'todas') || (r.culturas && r.culturas !== 'todas'))) continue;
    const revisao = r.revisado_por ? '' : ' (regra em revisão)';
    const tipo = r.tipo ?? 'alerta';

    if (tipo === 'alerta') {
      const conds = r.quando ?? r.qualquer ?? [];
      if (!conds.length) continue;
      const avals = conds.map((c) => avaliar(c, s, agoraLocal));
      const ok = r.qualquer ? avals.some((a) => a.ok) : avals.every((a) => a.ok);
      if (!ok) continue;
      const principal = (r.qualquer ? avals.find((a) => a.ok) : avals[0])!;
      let severidade: Severidade = r.severidade ?? 'atencao';
      if (r.grave_se && compara(principal.valor, r.grave_se.operador, r.grave_se.valor)) severidade = 'grave';
      if (lavoura && r.fases_grave?.includes(lavoura.fase)) severidade = 'grave';
      out.push({
        regra: r.id,
        titulo: r.titulo,
        severidade,
        alerta: severidade !== 'info',
        dia: principal.hora?.slice(0, 10) ?? hoje,
        texto: formatar(r.mensagem ?? r.titulo, { valor: principal.valor, quando: principal.hora ? quandoLegivel(principal.hora, agoraLocal) : 'nos próximos dias', cultura: cultura?.nome ?? '', fase: faseNome }) + revisao,
      });
    } else if (tipo === 'janela') {
      const idx = indicesDaJanela(r.janela ?? 'proximas_24h', s.time, agoraLocal).filter((i) => {
        const h = Number(s.time[i]!.slice(11, 13));
        return !r.apenas_dia || (h >= 6 && h <= 18);
      });
      const boas = idx.filter((i) => (r.condicoes_hora ?? []).every((c) => {
        const v = s.get(c.variavel, i);
        return v !== null && compara(v, c.operador, c.valor);
      }));
      const janelas = faixas(boas.map((i) => s.time[i]!), agoraLocal);
      out.push({
        regra: r.id,
        titulo: r.titulo,
        severidade: 'info',
        alerta: false,
        dia: hoje,
        texto: formatar((janelas.length ? r.mensagem_com : r.mensagem_sem) ?? r.titulo, { janelas: janelas.join(', ') }) + revisao,
      });
    } else if (tipo === 'balanco') {
      if (!lavoura || (r.apenas_irrigadas && !lavoura.irrigada)) continue;
      const kc = cultura?.fases[lavoura.fase]?.kc ?? 1;
      if (kc <= 0) continue;
      const b = balancoHidrico(p, kc, r.dias ?? 7, r.chuva_prevista_dias ?? 2, lavoura.irrigouEm, agora, chuvaMedida);
      const limite = r.limite_mm ?? 25;
      const vars = { deficit: Math.round(b.deficit), chuva_prevista: Math.round(b.chuvaPrevista), dias: r.dias ?? 7 };
      const msg = b.deficit < limite ? r.mensagem_ok : b.chuvaPrevista >= b.deficit * 0.8 ? r.mensagem_esperar : r.mensagem_irrigar;
      const medida = b.medidos ? ` (com a chuva do seu pluviômetro em ${b.medidos} ${b.medidos === 1 ? 'dia' : 'dias'})` : '';
      out.push({ regra: r.id, titulo: r.titulo, severidade: 'info', alerta: false, dia: hoje, texto: formatar(msg ?? r.titulo, vars) + medida + revisao });
    }
  }
  return out;
}

/**
 * Balanço de água dos últimos dias: Σ(ET0 × Kc) − chuva, contado desde a última irrigação informada, e a chuva
 * prevista nos próximos dias. A chuva de cada dia é a do pluviômetro da pessoa (`medida`, { dia: mm }) quando ela
 * informou; senão, a estimativa diária do Open-Meteo. `medidos`: quantos dias usaram o pluviômetro.
 */
export function balancoHidrico(p: Previsao, kc: number, dias: number, diasPrevistos: number, irrigouEm: string | null, agora = new Date(), medida: Record<string, number> = {}) {
  const hoje = horaLocal(agora, p.utcOffsetSeconds).slice(0, 10);
  const time = p.dias.time;
  const et0 = p.dias.et0_fao_evapotranspiration as Array<number | null>;
  const chuva = p.dias.precipitation_sum as Array<number | null>;
  const desde = irrigouEm ? irrigouEm.slice(0, 10) : '';
  let deficit = 0;
  let medidos = 0;
  const serie: Array<{ dia: string; et: number; chuva: number; deficit: number; medida: boolean }> = [];
  time.forEach((dia, i) => {
    if (dia >= hoje || dia < somarHoras(`${hoje}T12:00`, -24 * dias).slice(0, 10)) return;
    if (desde && dia <= desde) deficit = 0;
    const et = (et0[i] ?? 0) * kc;
    const doPluviometro = typeof medida[dia] === 'number';
    const c = doPluviometro ? medida[dia]! : (chuva[i] ?? 0);
    deficit = Math.max(0, deficit + et - c);
    if (!(desde && dia <= desde)) {
      if (doPluviometro) medidos++;
      serie.push({ dia, et: round(et, 1), chuva: round(c, 1), deficit: round(deficit, 1), medida: doPluviometro });
    }
  });
  const chuvaPrevista = time.reduce((total, dia, i) => (dia >= hoje && dia < somarHoras(`${hoje}T12:00`, 24 * diasPrevistos).slice(0, 10) ? total + (chuva[i] ?? 0) : total), 0);
  return { deficit: round(deficit, 1), chuvaPrevista: round(chuvaPrevista, 1), serie, medidos };
}

/**
 * Água da semana que vem: quanto a planta deve usar (ET0 previsto × Kc da fase, FAO-56) e quanto a chuva prevista
 * cobre. 1 mm = 1 litro por metro quadrado. É conta com a previsão e o Kc de referência, não medição no local.
 */
export function aguaDaSemana(p: Previsao, kc: number, dias = 7, agora = new Date()): { usa: number; chuva: number; falta: number } {
  const hoje = horaLocal(agora, p.utcOffsetSeconds).slice(0, 10);
  const time = p.dias.time;
  const et0 = p.dias.et0_fao_evapotranspiration as Array<number | null>;
  const chuva = p.dias.precipitation_sum as Array<number | null>;
  const idx = time.flatMap((d, i) => (d >= hoje ? [i] : [])).slice(0, dias);
  const usa = idx.reduce((s, i) => s + (et0[i] ?? 0) * kc, 0);
  const vem = idx.reduce((s, i) => s + (chuva[i] ?? 0), 0);
  return { usa: round(usa, 0), chuva: round(vem, 0), falta: round(Math.max(0, usa - vem), 0) };
}

/** Horas boas seguidas viram faixas legíveis: "hoje 6h–10h, amanhã 7h–9h". */
function faixas(horas: string[], agoraLocal: string): string[] {
  const out: string[] = [];
  let inicio: string | null = null;
  let anterior: string | null = null;
  const fechar = () => {
    if (!inicio || !anterior) return;
    const fim = Number(anterior.slice(11, 13)) + 1;
    out.push(`${quandoLegivel(inicio, agoraLocal).replace(' às ', ' ')}–${fim}h`);
  };
  for (const h of horas) {
    if (anterior && somarHoras(anterior, 1) === h) {
      anterior = h;
      continue;
    }
    fechar();
    inicio = h;
    anterior = h;
  }
  fechar();
  return out.slice(0, 4);
}

function round(n: number, casas: number): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}
