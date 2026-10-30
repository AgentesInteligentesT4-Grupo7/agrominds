import type { Lavoura, Lugar } from './Banco.js';
import { type Previsao, horaLocal } from './OpenMeteo.js';
import { type Cultura, type Resultado, quandoLegivel } from './Regras.js';

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

export function cabecalho(lugar: Lugar, lavoura: Lavoura | undefined, culturas: Cultura[]): string {
  const c = culturas.find((x) => x.id === lavoura?.cultura);
  const fase = c?.fases[lavoura?.fase ?? '']?.nome;
  return `${lugar.nome}${c ? ` (${c.nome.toLowerCase()}${fase ? `, ${fase.toLowerCase()}` : ''}${lavoura?.irrigada ? ', irrigada' : ''})` : ''}`;
}

/** Resposta do /clima: agora, próximos dias e o que as regras dizem. */
export function mensagemClima(p: Previsao, lugar: Lugar, lavoura: Lavoura | undefined, culturas: Cultura[], resultados: Resultado[], agora = new Date()): string {
  const a = p.atual;
  return [
    `🌱 ${cabecalho(lugar, lavoura, culturas)}`,
    '',
    `Agora: ${num(a.temperature_2m)}°C, ${tempo(a.weather_code as number)}, umidade ${num(a.relative_humidity_2m)}%, vento ${num(a.wind_speed_10m)} km/h`,
    ...proximosDias(p, 4, agora),
    ...(resultados.length ? ['', ...ordenar(resultados).map((r) => r.texto)] : []),
    ...(lavoura ? [] : ['', 'Diga o que você planta com /lavoura para receber recomendações da sua cultura.']),
    '',
    rodape(p),
  ].join('\n');
}

/** Boletim dos horários escolhidos: o dia, os riscos e as recomendações. */
export function mensagemBoletim(p: Previsao, lugar: Lugar, lavoura: Lavoura | undefined, culturas: Cultura[], resultados: Resultado[], agora = new Date()): string {
  const hora = Number(horaLocal(agora, p.utcOffsetSeconds).slice(11, 13));
  return [
    `${hora < 12 ? '🌅' : '🌇'} Boletim das ${hora}h — ${cabecalho(lugar, lavoura, culturas)}`,
    '',
    ...proximosDias(p, 2, agora),
    ...(resultados.length ? ['', ...ordenar(resultados).map((r) => r.texto)] : ['', '✅ Nada que exija atenção nas próximas horas.']),
    '',
    rodape(p),
  ].join('\n');
}

export function mensagemAlerta(lugar: Lugar, resultados: Resultado[], p: Previsao): string {
  return [`⚠️ Aviso para ${lugar.nome}`, '', ...ordenar(resultados).map((r) => r.texto), '', rodape(p)].join('\n');
}

function ordenar(r: Resultado[]): Resultado[] {
  const peso = { grave: 0, atencao: 1, info: 2 };
  return [...r].sort((a, b) => peso[a.severidade] - peso[b.severidade]);
}

function rodape(p: Previsao): string {
  return `Dados: Open-Meteo.com${p.desatualizada ? ' (última previsão guardada; o serviço não respondeu agora)' : ''} · /clima /lavoura /alertas`;
}
