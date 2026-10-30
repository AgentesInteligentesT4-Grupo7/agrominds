import type { Banco, Lavoura, Lugar } from './Banco.js';
import { UserFacingError } from './erros.js';
import type { FitaApi, TelegramResposta } from './k7.js';
import type { Layouts } from './Layouts.js';
import { legenda, mensagemBoletim, mensagemClima, tituloBoletim } from './Mensagens.js';
import type { Notificador } from './Notificador.js';
import type { OpenMeteo, Previsao } from './OpenMeteo.js';
import { type LinhaCalendario, type Planta, calendario, lavourasAtuais, municipioDoLugar, nomeDaPlanta, resumoPlantas, sugestoes, textoCalendario } from './Plantas.js';
import { type Cultura, type Regra, type Resultado, avaliarTodas } from './Regras.js';
import { type OpcaoPeriodo, dadosCalendario, dadosPlantas, dadosPrevisao, dadosTempo, periodoDe, textoPrevisao } from './Visual.js';
import { type Zarc, chaveDeNome } from './Zarc.js';

/** O que as partes da fita (Telegram, notificações, ferramentas, painel) dividem. */
export interface Contexto {
  k7: FitaApi;
  banco: Banco;
  meteo: OpenMeteo;
  zarc: Zarc;
  layouts: Layouts;
  regras: () => Regra[];
  culturas: () => Cultura[];
  plantas: () => Planta[];
  notificador: Notificador;
  /** Nome legível do lugar (cidade/UF) a partir da coordenada; sem rede, devolve a coordenada. */
  nomeDoLugar: (lat: number, lon: number) => Promise<{ nome: string; uf: string | null }>;
}

export type Base = Omit<Contexto, 'notificador'>;

const SEM_LUGAR = 'Primeiro me mande a sua localização: toque em /start e no botão "📍 Enviar minha localização".';

/** Data local de hoje (AAAA-MM-DD) no fuso de Brasília (para o calendário, que não depende da previsão). */
export function hojeLocal(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

export function lugarOuErro(c: Base, userId: string | undefined): Lugar {
  const lugar = userId ? c.banco.lugar(userId) : undefined;
  if (!lugar) throw new UserFacingError(SEM_LUGAR);
  return lugar;
}

/** As plantas da pessoa com a fase de hoje. */
export function plantasDe(c: Base, userId: string, hoje = hojeLocal()): Lavoura[] {
  return lavourasAtuais(c.banco.lavouras(userId), c.plantas(), c.culturas(), hoje);
}

export function nomeDe(c: Base): (l: Lavoura) => string {
  return (l) => nomeDaPlanta(l.planta, c.plantas(), c.culturas());
}

/** Avalia as regras para tudo o que a pessoa planta. */
export function avaliar(c: Base, p: Previsao, lavouras: Lavoura[], agora = new Date()): Resultado[] {
  return avaliarTodas(c.regras(), p, lavouras, c.culturas(), nomeDe(c), agora);
}

export interface Saida {
  /** Texto completo (histórico do painel, ou no lugar da imagem). */
  texto: string;
  mensagem: string | TelegramResposta;
  resultados: Resultado[];
}

/** /clima e o boletim: o layout do tempo com os avisos e as recomendações. */
export async function tempoAgora(c: Base, userId: string, tipo: 'clima' | 'boletim', agora = new Date()): Promise<Saida> {
  const lugar = lugarOuErro(c, userId);
  const p = await c.meteo.previsao(lugar.celula);
  const lavouras = plantasDe(c, userId, hojeLocal(agora));
  const resultados = avaliar(c, p, lavouras, agora);
  const resumo = resumoPlantas(lavouras, c.plantas(), c.culturas());
  const titulo = tipo === 'boletim' ? tituloBoletim(p, agora) : '🌱 Tempo agora';
  const texto = tipo === 'boletim' ? mensagemBoletim(p, lugar, resumo, resultados, agora) : mensagemClima(p, lugar, resumo, resultados, agora);
  const dados = dadosTempo(p, lugar, resumo, resultados, titulo.replace(/^\S+ /, ''), agora);
  const mensagem = await c.layouts.mensagem('tempo', dados, legenda(`${titulo} · ${lugar.nome}`, resultados), texto);
  return { texto, mensagem, resultados };
}

/** /previsao: o período escolhido (hoje, amanhã, fim de semana, 3, 7 ou 14 dias). */
export async function previsaoDoPeriodo(c: Base, userId: string, opcao: OpcaoPeriodo, agora = new Date()): Promise<Omit<Saida, 'resultados'>> {
  const lugar = lugarOuErro(c, userId);
  const p = await c.meteo.previsao(lugar.celula);
  const dados = dadosPrevisao(p, lugar, periodoDe(opcao, hojeLocal(agora)), agora);
  const texto = textoPrevisao(dados);
  return { texto, mensagem: await c.layouts.mensagem('previsao', dados, `🌦️ ${dados.titulo} · ${lugar.nome}\n${dados.resumo.join('\n')}`, texto) };
}

/** Calendário do município: das plantas da pessoa, ou (sem plantas, ou `todas`) do catálogo inteiro ou de um grupo. */
export function linhasDoCalendario(c: Base, userId: string, opcoes: { todas?: boolean; grupo?: Planta['grupo']; plantas?: string[] } = {}): { lugar: Lugar; linhas: LinhaCalendario[]; geocodigo: string | undefined } {
  const lugar = lugarOuErro(c, userId);
  const municipio = municipioDoLugar(c.zarc, lugar);
  const minhas = c.banco.lavouras(userId);
  const catalogo = c.plantas();
  const escolhidas = opcoes.plantas
    ? catalogo.filter((p) => opcoes.plantas!.includes(p.id))
    : opcoes.todas || opcoes.grupo || !minhas.length
      ? catalogo.filter((p) => p.zarc.length && (!opcoes.grupo || p.grupo === opcoes.grupo))
      : minhas.map((l) => catalogo.find((p) => p.id === l.planta)).filter((p): p is Planta => Boolean(p));
  return { lugar, linhas: calendario(c.zarc, municipio?.geocodigo, escolhidas, minhas), geocodigo: municipio?.geocodigo };
}

/** Planta do catálogo pelo id ou pelo nome, sem ligar para acento e maiúscula ("feijão", "Feijao", "batata-doce"). */
export function acharPlanta(c: Base, termo: string): Planta | undefined {
  const k = chaveDeNome(termo);
  if (!k) return undefined;
  const catalogo = c.plantas();
  return (
    catalogo.find((p) => chaveDeNome(p.id) === k || chaveDeNome(p.nome) === k) ??
    // "mandioca" acha "Mandioca"; "cana" acha "Cana-de-açúcar"; "caupi" acha "Feijão-de-corda (caupi)"
    catalogo.find((p) => k.length >= 4 && (chaveDeNome(p.nome).startsWith(k) || chaveDeNome(p.nome).includes(k)))
  );
}

/** "feijão, alface e couve" ou "e o feijão?" → ["feijão", "alface", "couve"] (o que a pessoa escreveu depois do comando). */
export function nomesPedidos(texto: string): string[] {
  return texto
    .split(/[,;?!.]|\s+e\s+/i)
    .map((t) => t.trim().replace(/^((e|o|a|os|as|de|do|da)\s+)+/i, '').trim())
    .filter(Boolean);
}

/** Nome em ordem alfabética (português); as épocas da mesma planta ficam juntas, na ordem do catálogo. */
function emOrdemAlfabetica<T extends { nome: string }>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function avisoSemZarc(c: Base, geocodigo: string | undefined): string | undefined {
  if (c.zarc.vazio()) return 'O calendário oficial (ZARC) ainda não foi baixado: ele chega na primeira atualização da fita (ou com "npm run fita -- agrominds zarc").';
  if (!geocodigo) return 'Não achei o seu município no zoneamento: mande a localização de novo (com o nome da cidade ligado) para eu ver o calendário.';
  return undefined;
}

/**
 * /calendario e /plantar: o layout do calendário (com o que dá para plantar agora em destaque, em ordem alfabética).
 * `incluir`: plantas que a pessoa pediu (id ou nome) e que entram a mais na tabela, marcadas "você pediu", mesmo
 * fora de época ou sem dado oficial.
 */
export async function calendarioDe(
  c: Base,
  userId: string,
  opcoes: { todas?: boolean; grupo?: Planta['grupo']; plantas?: string[]; sugerir?: boolean; incluir?: string[] } = {},
  agora = new Date(),
): Promise<Omit<Saida, 'resultados'>> {
  const hoje = hojeLocal(agora);
  const { lugar, linhas, geocodigo } = linhasDoCalendario(c, userId, opcoes);
  const aviso = avisoSemZarc(c, geocodigo);
  const titulo = opcoes.sugerir ? `O que plantar agora${opcoes.grupo === 'horta' ? ' na horta' : opcoes.grupo === 'lavoura' ? ' na lavoura' : ''}` : 'Calendário de plantio';
  const safra = c.zarc.arquivos().find((a) => a.arquivo === 'safra')?.nome.match(/\d{4}\/\d{4}/)?.[0];
  // Nas sugestões, a tabela mostra só o que está na lista (aberto agora ou abrindo logo), em ordem alfabética.
  let mostrar = linhas;
  if (opcoes.sugerir) {
    const s = sugestoes(linhas, hoje);
    const naLista = new Set([...s.agora, ...s.logo].map((l) => l.planta));
    mostrar = emOrdemAlfabetica(linhas.filter((l) => naLista.has(l.planta) && !l.semDado));
  }
  // O que a pessoa pediu e não está na tabela vem a mais, no fim.
  const pedidas: Planta[] = [];
  const desconhecidas: string[] = [];
  for (const termo of opcoes.incluir ?? []) {
    const p = acharPlanta(c, termo);
    if (!p) desconhecidas.push(termo);
    else if (!mostrar.some((l) => l.planta === p.id) && !pedidas.includes(p)) pedidas.push(p);
  }
  // "Você pediu" só faz sentido quando a planta entra a mais numa lista (nas sugestões ou no calendário da pessoa).
  const marcar = opcoes.sugerir === true || mostrar.length > 0;
  mostrar = [
    ...mostrar,
    ...calendario(c.zarc, geocodigo, pedidas, c.banco.lavouras(userId)).map((l) => ({ ...l, ...(marcar ? { pedida: true } : {}) })),
    ...desconhecidas.map((nome) => ({ planta: chaveDeNome(nome), nome: nome[0]!.toUpperCase() + nome.slice(1), risco: new Array<number>(36).fill(0), semDado: 'fora_do_catalogo' as const, ...(marcar ? { pedida: true } : {}) })),
  ];
  const dados = dadosCalendario(lugar, mostrar, hoje, { titulo, ...(safra ? { safra } : {}), destaque: opcoes.sugerir === true, ...(aviso ? { vazio: aviso } : {}) });
  const texto = [`📅 ${titulo} · ${lugar.nome}`, '', ...(aviso ? [aviso] : textoCalendario(mostrar)), '', 'Fonte: ZARC (MAPA/Embrapa)'].join('\n');
  const destaque = dados.destaque ? `\nAgora: ${dados.destaque.agora.join(', ') || 'nada com janela aberta'}` : '';
  return { texto, mensagem: aviso ? texto : await c.layouts.mensagem('calendario', dados, `📅 ${titulo} · ${lugar.nome}${destaque}`, texto) };
}

/** /plantas: o layout "Minhas plantas". */
export async function minhasPlantas(c: Base, userId: string, agora = new Date()): Promise<Omit<Saida, 'resultados'>> {
  const hoje = hojeLocal(agora);
  const lugar = lugarOuErro(c, userId);
  const lavouras = c.banco.lavouras(userId);
  const { linhas } = linhasDoCalendario(c, userId);
  const dados = dadosPlantas(lugar, lavouras, c.plantas(), c.culturas(), linhas, hoje, !c.zarc.vazio());
  const texto = [`🌱 Minhas plantas · ${lugar.nome}`, '', ...dados.plantas.map((p) => `• ${p.nome}${p.fase ? ` — ${p.fase.toLowerCase()}` : ''}${p.irrigada ? ', irrigada' : ''}${p.colheita ? `, colheita estimada ${p.colheita}` : ''}\n  ${p.janela}`)].join('\n');
  return { texto, mensagem: await c.layouts.mensagem('plantas', dados, `🌱 Minhas plantas · ${lugar.nome}`, texto) };
}
