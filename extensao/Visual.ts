import type { Lavoura, Lugar } from './Banco.js';
import { type Previsao, horaLocal, somarHoras } from './OpenMeteo.js';
import { type LinhaCalendario, type Planta, decendioDe, faixas, faseAtual, sugestoes, textoFaixa } from './Plantas.js';
import type { Cultura, Resultado } from './Regras.js';

/** Dados de cada layout (layouts/*.html): o que a página espera em `window.DADOS`. */

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const PESO = { grave: 0, atencao: 1, info: 2 } as const;
const RODAPE_TEMPO = 'Dados: Open-Meteo.com (previsão de modelos meteorológicos) · regras em revisão por agrônomo(a)';

export function descricaoDoTempo(codigo: number | null | undefined): string {
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

function diaDaSemana(data: string): number {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}

/** "Hoje", "Amanhã" ou o dia da semana; `curto`: "Sáb". */
export function nomeDoDia(data: string, hoje: string, curto = false): string {
  if (data === hoje) return 'Hoje';
  if (data === somarHoras(`${hoje}T12:00`, 24).slice(0, 10)) return 'Amanhã';
  return (curto ? CURTOS : DIAS)[diaDaSemana(data)]!;
}

const alfabetica = (a: string, b: string) => a.localeCompare(b, 'pt-BR');
const ddmm = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;
const n = (v: unknown) => (typeof v === 'number' ? v : null);

export interface DiaLayout {
  nome: string;
  data: string;
  max: number | null;
  min: number | null;
  chuva: number | null;
  probabilidade: number | null;
  codigo: number | null;
  vento?: number | null;
}

function dia(p: Previsao, i: number, hoje: string, curto: boolean): DiaLayout {
  const d = p.dias;
  const data = d.time[i]!;
  return {
    nome: nomeDoDia(data, hoje, curto),
    data: ddmm(data),
    max: n(d.temperature_2m_max?.[i]),
    min: n(d.temperature_2m_min?.[i]),
    chuva: n(d.precipitation_sum?.[i]),
    probabilidade: n(d.precipitation_probability_max?.[i]),
    codigo: n(d.weather_code?.[i]),
    vento: n(d.wind_gusts_10m_max?.[i]),
  };
}

function aviso(r: Resultado) {
  return { severidade: r.severidade, titulo: r.titulo, texto: r.texto };
}

/** Layout `tempo`: boletim e /clima. */
export function dadosTempo(p: Previsao, lugar: Lugar, resumoPlantas: string, resultados: Resultado[], titulo: string, agora = new Date()) {
  const local = horaLocal(agora, p.utcOffsetSeconds);
  const hoje = local.slice(0, 10);
  const a = p.atual;
  const iHoje = p.dias.time.indexOf(hoje);
  const h = p.horas;
  const horas = h.time.flatMap((t, i) =>
    t >= local.slice(0, 13) && t <= somarHoras(local, 24) ? [{ rotulo: `${Number(t.slice(11, 13))}h`, temperatura: n(h.temperature_2m?.[i]), chuva: n(h.precipitation?.[i]) }] : [],
  );
  const ordenados = [...resultados].sort((x, y) => PESO[x.severidade] - PESO[y.severidade]);
  return {
    titulo,
    lugar: lugar.nome,
    quando: `${DIAS[diaDaSemana(hoje)]}, ${ddmm(hoje)} às ${Number(local.slice(11, 13))}h`,
    plantas: resumoPlantas,
    agora: {
      temperatura: n(a.temperature_2m),
      descricao: descricaoDoTempo(n(a.weather_code)),
      codigo: n(a.weather_code),
      umidade: n(a.relative_humidity_2m),
      vento: n(a.wind_speed_10m),
      chuvaHoje: iHoje >= 0 ? n(p.dias.precipitation_sum?.[iHoje]) : null,
    },
    dias: p.dias.time.flatMap((t, i) => (t >= hoje ? [i] : [])).slice(0, 4).map((i) => dia(p, i, hoje, false)),
    horas,
    avisos: ordenados.filter((r) => r.alerta).map(aviso),
    recomendacoes: ordenados.filter((r) => !r.alerta).map((r) => r.texto),
    rodape: `${RODAPE_TEMPO}${p.desatualizada ? ' · última previsão guardada (o serviço não respondeu agora)' : ''}`,
  };
}

/** Layout `alerta`: avisos fora do boletim. */
export function dadosAlerta(p: Previsao, lugar: Lugar, resultados: Resultado[], agora = new Date()) {
  const local = horaLocal(agora, p.utcOffsetSeconds);
  return {
    lugar: lugar.nome,
    quando: `${DIAS[diaDaSemana(local.slice(0, 10))]}, ${ddmm(local.slice(0, 10))} às ${Number(local.slice(11, 13))}h`,
    avisos: [...resultados].sort((x, y) => PESO[x.severidade] - PESO[y.severidade]).map(aviso),
    rodape: RODAPE_TEMPO,
  };
}

// ------------------------------------------------------------------ previsão por período

export type OpcaoPeriodo = 'hoje' | 'amanha' | 'fds' | '3' | '7' | '14';
/** Na ordem dos botões (lista: chaves como "3" iriam para o começo de um objeto). */
export const PERIODOS: Array<[OpcaoPeriodo, string]> = [['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['fds', 'Fim de semana'], ['3', '3 dias'], ['7', '7 dias'], ['14', '14 dias']];

export function ehPeriodo(valor: unknown): valor is OpcaoPeriodo {
  return PERIODOS.some(([id]) => id === valor);
}

export interface Periodo {
  inicio: string;
  fim: string;
  titulo: string;
}

/** Datas (locais) de uma opção de período; "fim de semana" é o próximo sábado e domingo (ou o atual). */
export function periodoDe(opcao: OpcaoPeriodo, hoje: string): Periodo {
  const mais = (dias: number) => somarHoras(`${hoje}T12:00`, 24 * dias).slice(0, 10);
  if (opcao === 'hoje') return { inicio: hoje, fim: hoje, titulo: 'Previsão de hoje' };
  if (opcao === 'amanha') return { inicio: mais(1), fim: mais(1), titulo: 'Previsão de amanhã' };
  if (opcao === 'fds') {
    const dow = diaDaSemana(hoje);
    const sabado = dow === 0 ? mais(-1) : mais(6 - dow);
    const inicio = sabado < hoje ? hoje : sabado;
    return { inicio, fim: dow === 0 ? hoje : mais(7 - dow), titulo: 'Previsão do fim de semana' };
  }
  const dias = Number(opcao);
  return { inicio: hoje, fim: mais(dias - 1), titulo: `Previsão · próximos ${dias} dias` };
}

/** Layout `previsao`: até 3 dias, gráfico hora a hora; mais que isso, dia a dia. */
export function dadosPrevisao(p: Previsao, lugar: Lugar, periodo: Periodo, agora = new Date()) {
  const local = horaLocal(agora, p.utcOffsetSeconds);
  const hoje = local.slice(0, 10);
  const idx = p.dias.time.flatMap((t, i) => (t >= periodo.inicio && t <= periodo.fim ? [i] : []));
  const dias = idx.map((i) => dia(p, i, hoje, idx.length > 4));
  const h = p.horas;
  const horas =
    idx.length <= 3
      ? h.time.flatMap((t, i) => {
          const naJanela = t.slice(0, 10) >= periodo.inicio && t.slice(0, 10) <= periodo.fim && t >= local.slice(0, 13);
          const rotulo = idx.length === 1 ? `${Number(t.slice(11, 13))}h` : `${CURTOS[diaDaSemana(t.slice(0, 10))]} ${Number(t.slice(11, 13))}h`;
          return naJanela ? [{ rotulo, temperatura: n(h.temperature_2m?.[i]), chuva: n(h.precipitation?.[i]) }] : [];
        })
      : null;
  const resumo: string[] = [];
  if (dias.length) {
    const total = dias.reduce((s, d) => s + (d.chuva ?? 0), 0);
    const maisChuva = dias.reduce((a, b) => ((b.chuva ?? 0) > (a.chuva ?? 0) ? b : a));
    const quente = dias.reduce((a, b) => ((b.max ?? -99) > (a.max ?? -99) ? b : a));
    const frio = dias.reduce((a, b) => ((b.min ?? 99) < (a.min ?? 99) ? b : a));
    resumo.push(total > 0.2 ? `🌧️ Chuva no período: ${total.toFixed(1).replace('.', ',')} mm (mais ${maisChuva.nome === 'Hoje' || maisChuva.nome === 'Amanhã' ? maisChuva.nome.toLowerCase() : `em ${maisChuva.nome.toLowerCase()}`}, ${maisChuva.data})` : '☀️ Sem chuva prevista no período');
    if (dias.length > 1) resumo.push(`🌡️ Mais quente: ${quente.nome.toLowerCase()} ${quente.data}, ${Math.round(quente.max ?? 0)}° · mais frio: ${frio.nome.toLowerCase()} ${frio.data}, ${Math.round(frio.min ?? 0)}°`);
    const vento = dias.reduce((a, b) => ((b.vento ?? 0) > (a.vento ?? 0) ? b : a));
    if ((vento.vento ?? 0) >= 40) resumo.push(`💨 Rajadas de até ${Math.round(vento.vento ?? 0)} km/h (${vento.nome.toLowerCase()} ${vento.data})`);
  }
  const textoPeriodo = periodo.inicio === periodo.fim ? `${DIAS[diaDaSemana(periodo.inicio)]!.toLowerCase()} ${ddmm(periodo.inicio)}` : `${DIAS[diaDaSemana(periodo.inicio)]!.toLowerCase()} ${ddmm(periodo.inicio)} a ${DIAS[diaDaSemana(periodo.fim)]!.toLowerCase()} ${ddmm(periodo.fim)}`;
  return {
    titulo: periodo.titulo,
    lugar: lugar.nome,
    periodo: textoPeriodo,
    dias,
    horas,
    resumo,
    rodape: `Dados: Open-Meteo.com · previsão de modelos meteorológicos (não é medição no seu local)${idx.length > 7 ? ' · além de 7 dias, a previsão é só tendência' : ''}`,
  };
}

/** Texto da previsão do período (legenda e quando não há imagem). */
export function textoPrevisao(d: ReturnType<typeof dadosPrevisao>): string {
  const num = (v: number | null, c = 0) => (v === null ? '–' : v.toFixed(c).replace('.', ','));
  return [
    `🌦️ ${d.titulo} · ${d.lugar}`,
    '',
    ...d.dias.map((x) => `${x.nome} ${x.data}: ${num(x.min)}° → ${num(x.max)}°, chuva ${num(x.probabilidade)}% (${num(x.chuva, 1)} mm)`),
    ...(d.resumo.length ? ['', ...d.resumo] : []),
    '',
    'Dados: Open-Meteo.com',
  ].join('\n');
}

// ------------------------------------------------------------------ plantas e calendário

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ddmes = (data: string) => `${Number(data.slice(8, 10))}/${MESES[Number(data.slice(5, 7)) - 1]}`;

/** Layout `plantas`: cada planta com fase, ciclo e a janela de plantio do município. */
export function dadosPlantas(lugar: Lugar, lavouras: Lavoura[], catalogo: Planta[], culturas: Cultura[], linhas: LinhaCalendario[], hoje: string, temZarc: boolean) {
  const dec = decendioDe(hoje);
  return {
    titulo: 'Minhas plantas',
    lugar: lugar.nome,
    hoje: dec,
    plantas: lavouras.map((l) => {
      const planta = catalogo.find((p) => p.id === l.planta);
      const cultura = culturas.find((c) => c.id === l.cultura);
      const f = faseAtual(l, planta, cultura, hoje);
      const suas = linhas.filter((x) => x.planta === l.planta);
      const comDado = suas.filter((x) => !x.semDado);
      // Várias épocas (1ª e 2ª safra) numa faixa só: o menor risco de cada decêndio.
      const risco = comDado.length
        ? Array.from({ length: 36 }, (_, i) => {
            const v = comDado.map((x) => x.risco[i]!).filter(Boolean);
            return v.length ? Math.min(...v) : 0;
          })
        : null;
      const janela = !planta?.zarc.length
        ? 'Sem zoneamento oficial (ZARC) para esta planta'
        : !temZarc
          ? 'Calendário do zoneamento ainda não carregado'
          : comDado.length
            ? comDado.map((x) => `${x.epoca ? `${x.epoca}: ` : 'Plantar de '}${faixas(x.risco).map(textoFaixa).join('; ')}${x.manejo === 'Irrigado' ? ' (irrigado)' : ''}`).join(' · ')
            : 'O ZARC não indica plantio no seu município';
      return {
        nome: planta?.nome ?? l.planta,
        grupo: planta?.grupo ?? 'horta',
        fase: cultura?.fases[f.fase]?.nome ?? null,
        irrigada: l.irrigada,
        ...(l.plantio && f.dias !== undefined && f.dias >= 0 ? { plantio: ddmm(l.plantio), dias: f.dias, ciclo: planta?.cicloDias ?? null, colheita: f.colheita ? ddmes(f.colheita) : null, passou: f.passou ?? false } : {}),
        janela,
        agora: risco ? risco[dec - 1]! > 0 : null,
        risco,
      };
    }),
    rodape: 'Janelas: ZARC (MAPA/Embrapa), solo de textura média · colheita estimada pelo ciclo médio (referência a revisar)',
  };
}

/** Layout `calendario`: as plantas pedidas no município, com o que dá para plantar agora em destaque. */
export function dadosCalendario(lugar: Lugar, linhas: LinhaCalendario[], hoje: string, opcoes: { titulo?: string; safra?: string; destaque?: boolean; vazio?: string } = {}) {
  const s = sugestoes(linhas, hoje);
  const rotulo = (l: LinhaCalendario) => `${l.nome}${l.epoca ? ` (${l.epoca})` : ''}`;
  return {
    titulo: opcoes.titulo ?? 'Calendário de plantio',
    subtitulo: `${lugar.nome} · zoneamento agrícola (ZARC)${opcoes.safra ? ` ${opcoes.safra}` : ''}`,
    hoje: decendioDe(hoje),
    ...(opcoes.destaque
      ? {
          destaque: {
            titulo: 'Dá para plantar agora',
            // Em ordem alfabética (as que abrem logo, também).
            agora: s.agora.filter((l) => !l.pedida).map(rotulo).sort(alfabetica),
            logo: s.logo.filter((l) => !l.pedida).sort((a, b) => alfabetica(rotulo(a), rotulo(b))).map((l) => `${rotulo(l)} · em ${l.em * 10} dias`),
          },
        }
      : {}),
    linhas: linhas.map((l) => ({
      nome: l.nome,
      ...(l.epoca ? { epoca: l.epoca } : {}),
      risco: l.risco,
      ...(l.manejo ? { manejo: l.manejo } : {}),
      ...(l.minha ? { minha: true } : {}),
      ...(l.pedida ? { pedida: true } : {}),
      ...(l.semDado ? { semDado: l.semDado } : {}),
      ...(l.plantio ? { sua: { de: decendioDe(l.plantio), ate: decendioDe(l.colheita ?? l.plantio) } } : {}),
    })),
    ...(opcoes.vazio ? { vazio: opcoes.vazio } : {}),
    rodape: 'Fonte: ZARC (MAPA/Embrapa), solo de textura média, melhor caso entre ciclos e cultivares · confira a portaria do seu município',
  };
}
