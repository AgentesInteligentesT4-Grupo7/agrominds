import type { Lugar } from './Banco.js';
import { type Previsao, horaLocal } from './OpenMeteo.js';
import { type Resultado, quandoLegivel } from './Regras.js';

/**
 * Versões em texto do que vai como imagem (layouts/): ficam registradas no histórico do painel e vão no lugar da
 * imagem quando ela não pode ser gerada. A legenda da foto é só a primeira linha e os avisos.
 */

/** Código do tempo da OMM (o Open-Meteo usa) em palavras e ícone. */
export function tempo(codigo: number | null | undefined): string {
  const c = Number(codigo ?? -1);
  if (c === 0) return '☀️ céu limpo';
  if (c <= 2) return '🌤️ poucas nuvens';
  if (c === 3) return '☁️ nublado';
  if (c === 45 || c === 48) return '🌫️ nevoeiro';
  if (c >= 51 && c <= 57) return '🌦️ garoa';
  if (c >= 61 && c <= 67) return '🌧️ chuva';
  if (c >= 80 && c <= 82) return '🌧️ pancadas de chuva';
  if (c >= 95) return '⛈️ trovoada';
  return '🌡️';
}

const num = (n: unknown, casas = 0) => (typeof n === 'number' ? n.toFixed(casas).replace('.', ',') : '–');

function dia(p: Previsao, i: number, agoraLocal: string): string {
  const d = p.dias;
  const nome = quandoLegivel(`${d.time[i]}T12:00`, agoraLocal).replace(/ às 12h$/, '');
  return `${nome[0]!.toUpperCase()}${nome.slice(1)}: ${num(d.temperature_2m_min?.[i])}° → ${num(d.temperature_2m_max?.[i])}°, chuva ${num(d.precipitation_probability_max?.[i])}% (${num(d.precipitation_sum?.[i], 1)} mm)`;
}

/** Linhas com os próximos dias (hoje em diante). */
export function proximosDias(p: Previsao, quantos: number, agora = new Date()): string[] {
  const agoraLocal = horaLocal(agora, p.utcOffsetSeconds);
  const hoje = agoraLocal.slice(0, 10);
  return p.dias.time.flatMap((d, i) => (d >= hoje ? [i] : [])).slice(0, quantos).map((i) => dia(p, i, agoraLocal));
}

export function cabecalho(lugar: Lugar, resumoPlantas: string): string {
  return `${lugar.nome}${resumoPlantas ? ` (${resumoPlantas})` : ''}`;
}

/** Resposta do /clima: agora, próximos dias e o que as regras dizem. */
export function mensagemClima(p: Previsao, lugar: Lugar, resumoPlantas: string, resultados: Resultado[], agora = new Date()): string {
  const a = p.atual;
  return [
    `🌱 ${cabecalho(lugar, resumoPlantas)}`,
    '',
    `Agora: ${num(a.temperature_2m)}°C, ${tempo(a.weather_code as number)}, umidade ${num(a.relative_humidity_2m)}%, vento ${num(a.wind_speed_10m)} km/h`,
    ...proximosDias(p, 4, agora),
    ...(resultados.length ? ['', ...ordenar(resultados).map((r) => r.texto)] : []),
    ...(resumoPlantas ? [] : ['', 'Conte o que você planta em /plantas para receber recomendações para as suas plantas.']),
    '',
    rodape(p),
  ].join('\n');
}

/** Boletim dos horários escolhidos: o dia, os riscos e as recomendações. */
export function mensagemBoletim(p: Previsao, lugar: Lugar, resumoPlantas: string, resultados: Resultado[], agora = new Date()): string {
  return [
    `${tituloBoletim(p, agora)} — ${cabecalho(lugar, resumoPlantas)}`,
    '',
    ...proximosDias(p, 2, agora),
    ...(resultados.length ? ['', ...ordenar(resultados).map((r) => r.texto)] : ['', '✅ Nada que exija atenção nas próximas horas.']),
    '',
    rodape(p),
  ].join('\n');
}

export function tituloBoletim(p: Previsao, agora = new Date()): string {
  const hora = Number(horaLocal(agora, p.utcOffsetSeconds).slice(11, 13));
  return `${hora < 12 ? '🌅' : '🌇'} Boletim das ${hora}h`;
}

export function mensagemAlerta(lugar: Lugar, resultados: Resultado[], p: Previsao): string {
  return [`⚠️ Aviso para ${lugar.nome}`, '', ...ordenar(resultados).map((r) => r.texto), '', rodape(p)].join('\n');
}

/** Legenda curta da foto: o título e só os alertas (o resto está na imagem). */
export function legenda(titulo: string, resultados: Resultado[]): string {
  const alertas = ordenar(resultados).filter((r) => r.alerta);
  return [titulo, ...alertas.map((r) => `${r.severidade === 'grave' ? '🔴' : '🟠'} ${r.titulo}`)].join('\n');
}

export function ordenar(r: Resultado[]): Resultado[] {
  const peso = { grave: 0, atencao: 1, info: 2 };
  return [...r].sort((a, b) => peso[a.severidade] - peso[b.severidade]);
}

function rodape(p: Previsao): string {
  return `Dados: Open-Meteo.com${p.desatualizada ? ' (última previsão guardada; o serviço não respondeu agora)' : ''} · /clima /previsao /plantas /calendario`;
}
