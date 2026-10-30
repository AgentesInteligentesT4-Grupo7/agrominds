import { createRequire } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FitaApi, FitaSql, TelegramCtx, TelegramResposta } from '../extensao/k7.js';
import type { Previsao } from '../extensao/OpenMeteo.js';

/** Os testes rodam pelo K7, na pasta da fita (npm run fita -- agrominds testes, que informa K7_DIR): o leitor de YAML vem dele. */
const k7Dir = process.env.K7_DIR ?? path.resolve('../../ParreiraClaw');
export const lerYaml = (createRequire(path.join(k7Dir, 'package.json'))('js-yaml') as { load(t: string): unknown }).load;

/** Banco da fita nos testes: o SQLite que já vem no Node (sem pacotes). */
export function sqlEmMemoria(): FitaSql {
  const db = new DatabaseSync(':memory:');
  const limpar = <T>(r: unknown): T => (r && typeof r === 'object' ? ({ ...(r as object) } as T) : (r as T));
  return {
    exec: (sql) => void db.exec(sql),
    run: (sql, ...params) => {
      const r = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
    },
    get: (sql, ...params) => limpar(db.prepare(sql).get(...(params as never[]))),
    all: (sql, ...params) => db.prepare(sql).all(...(params as never[])).map((r) => limpar(r)),
    transacao: (fn) => {
      db.exec('BEGIN');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

type Handler = (ctx: never) => Promise<void> | void;

/** K7 de mentira: guarda o que a fita registra e o que ela manda pelo Telegram. */
export class K7Falso {
  readonly sql = sqlEmMemoria();
  readonly comandos = new Map<string, Handler>();
  readonly localizacao: Handler[] = [];
  readonly botoes = new Map<string, Handler>();
  readonly ferramentas = new Map<string, { run(args: Record<string, unknown>, ctx: { userId?: string }): Promise<string> }>();
  readonly enviados: Array<{ userId: string; mensagem: string | TelegramResposta }> = [];
  readonly tarefas: string[] = [];
  /** Quem o bot não consegue alcançar (ex.: bloqueou o bot). */
  readonly inalcancaveis = new Set<string>();
  acessos: Array<{ userId: number; nome: string; username: string | null; status: 'pendente' | 'ativo' | 'bloqueado'; origem: string; criadoEm: string; ultimoContato: string | null }> = [];

  constructor(private readonly dir = '.') {}

  api(env: Record<string, string> = {}): FitaApi {
    return {
      fita: { nome: 'agrominds', dir: this.dir, workspaceDir: '.', dadosDir: '.', env },
      log: { info: () => undefined, aviso: () => undefined, erro: () => undefined },
      ferramenta: (t) => void this.ferramentas.set(t.name, t as never),
      web: { rota: () => undefined, painel: () => undefined },
      comando: () => undefined,
      aoIniciar: () => undefined,
      util: {
        limitador: () => ({ run: (_c, t) => t() }),
        emParalelo: (itens, _m, t) => Promise.all(itens.map(t)),
        lerYaml: (texto) => lerYaml(texto),
      },
      processoPrincipal: false,
      tarefa: (nome) => void this.tarefas.push(nome),
      sql: this.sql,
      telegram: {
        comando: (nome, _d, fn) => void this.comandos.set(nome, fn as Handler),
        aoLocalizacao: (fn) => void this.localizacao.push(fn as Handler),
        botoes: (prefixo, fn) => void this.botoes.set(prefixo, fn as Handler),
        notificar: async (userId, mensagem) => {
          if (this.inalcancaveis.has(userId)) return { entregue: false, erro: 'Forbidden: bot was blocked by the user' };
          this.enviados.push({ userId, mensagem });
          return { entregue: true };
        },
        acessos: {
          listar: () => this.acessos,
          definir: (userId, status) => {
            const a = this.acessos.find((x) => x.userId === userId);
            if (a) a.status = status;
            return Boolean(a);
          },
          convite: async () => ({ codigo: 'abcdefgh12345678', link: 'https://t.me/agro_bot?start=abcdefgh12345678', png: Buffer.from('PNG'), expiraEm: '2026-11-06 12:00:00' }),
        },
      },
    };
  }

  /** Conversa de mentira com uma pessoa: o que o bot respondeu fica em `respostas`. */
  pessoa(userId = '50', nome = 'Ana Silva') {
    const respostas: Array<string | TelegramResposta> = [];
    const ctx: TelegramCtx = { userId, chatId: Number(userId), nome, responder: async (r) => void respostas.push(r) };
    return {
      respostas,
      comando: (nomeComando: string, args = '') => (this.comandos.get(nomeComando) as (c: unknown) => Promise<void>)({ ...ctx, args }),
      localizacao: async (lat: number, lon: number) => {
        for (const fn of this.localizacao) await (fn as (c: unknown) => Promise<void>)({ ...ctx, lat, lon });
      },
      toque: (dados: string) =>
        (this.botoes.get(dados.split(':')[0]!) as (c: unknown) => Promise<void>)({ ...ctx, dados, editar: async (r: string | TelegramResposta) => void respostas.push(r) }),
    };
  }
}

/**
 * Previsão sintética para os testes, no formato do Open-Meteo: 7 dias para trás e 7 para a frente, hora a hora,
 * a partir de `agoraLocal` ("2026-10-30T09:00", fuso −3 h). `ajuste` muda os valores de cada hora.
 */
export function previsaoSintetica(agoraLocal: string, ajuste: (hora: string, h: number) => Partial<Record<string, number>> = () => ({})): Previsao {
  const inicio = Date.parse(`${agoraLocal.slice(0, 10)}T00:00:00Z`) - 7 * 86400_000;
  const horas: Record<string, Array<number | null>> & { time: string[] } = { time: [] } as never;
  const vars = ['temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'precipitation', 'precipitation_probability', 'wind_speed_10m', 'wind_gusts_10m', 'et0_fao_evapotranspiration', 'vapour_pressure_deficit', 'soil_moisture_9_to_27cm', 'weather_code'];
  for (const v of vars) horas[v] = [];
  for (let i = 0; i < 14 * 24; i++) {
    const hora = new Date(inicio + i * 3600_000).toISOString().slice(0, 13) + ':00';
    const h = Number(hora.slice(11, 13));
    // Dia típico: 18° de madrugada, 28° à tarde, umidade 60–85%, vento 6 km/h, sem chuva.
    const base: Record<string, number> = {
      temperature_2m: 23 - 5 * Math.cos(((h - 3) / 24) * 2 * Math.PI),
      relative_humidity_2m: 72 + 13 * Math.cos(((h - 3) / 24) * 2 * Math.PI),
      dew_point_2m: 15,
      precipitation: 0,
      precipitation_probability: 10,
      wind_speed_10m: 6,
      wind_gusts_10m: 15,
      et0_fao_evapotranspiration: h >= 6 && h <= 18 ? 0.35 : 0,
      vapour_pressure_deficit: 1,
      soil_moisture_9_to_27cm: 0.25,
      weather_code: 1,
      ...ajuste(hora, h),
    };
    horas.time.push(hora);
    for (const v of vars) horas[v]!.push(Math.round(base[v]! * 10) / 10);
  }
  const dias: Record<string, Array<number | string | null>> & { time: string[] } = { time: [] } as never;
  for (const v of ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'et0_fao_evapotranspiration', 'wind_gusts_10m_max']) dias[v] = [];
  for (let d = 0; d < 14; d++) {
    const idx = horas.time.map((t, i) => [t, i] as const).filter(([t]) => t.startsWith(new Date(inicio + d * 86400_000).toISOString().slice(0, 10))).map(([, i]) => i);
    const serie = (v: string) => idx.map((i) => horas[v]![i]!);
    dias.time.push(horas.time[idx[0]!]!.slice(0, 10));
    dias.temperature_2m_max!.push(Math.max(...serie('temperature_2m')));
    dias.temperature_2m_min!.push(Math.min(...serie('temperature_2m')));
    dias.precipitation_sum!.push(Math.round(serie('precipitation').reduce((a, b) => a + b, 0) * 10) / 10);
    dias.precipitation_probability_max!.push(Math.max(...serie('precipitation_probability')));
    dias.et0_fao_evapotranspiration!.push(Math.round(serie('et0_fao_evapotranspiration').reduce((a, b) => a + b, 0) * 10) / 10);
    dias.wind_gusts_10m_max!.push(Math.max(...serie('wind_gusts_10m')));
  }
  return { celula: '-16.7,-49.3', timezone: 'America/Sao_Paulo', utcOffsetSeconds: -10800, consultadoEm: new Date().toISOString(), atual: { temperature_2m: 24, relative_humidity_2m: 70, weather_code: 1, wind_speed_10m: 6 }, horas, dias };
}

/** "agora" em UTC para uma hora local (fuso −3 h). */
export function quando(agoraLocal: string): Date {
  return new Date(Date.parse(`${agoraLocal}:00Z`) + 3 * 3600_000);
}
