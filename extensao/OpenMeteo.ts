import type { FitaSql } from './k7.js';
import { UserFacingError, errorMessage } from './erros.js';

/** Variáveis hora a hora pedidas ao Open-Meteo (nomes da API). */
export const HOURLY = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_gusts_10m',
  'et0_fao_evapotranspiration',
  'vapour_pressure_deficit',
  'soil_moisture_9_to_27cm',
  'weather_code',
] as const;
const DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max', 'et0_fao_evapotranspiration', 'wind_gusts_10m_max', 'sunrise', 'sunset'];
const CURRENT = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m'];

export interface Previsao {
  celula: string;
  /** Fuso do lugar (as horas das séries são locais). */
  timezone: string;
  utcOffsetSeconds: number;
  consultadoEm: string;
  /** Usou o último dado guardado porque o Open-Meteo não respondeu. */
  desatualizada?: boolean;
  atual: Record<string, number | string>;
  /** Séries hora a hora: `time` (local, "2026-10-30T14:00") e uma lista por variável. 7 dias atrás + 16 à frente. */
  horas: Record<string, Array<number | null>> & { time: string[] };
  dias: Record<string, Array<number | string | null>> & { time: string[] };
}

const MAX_IDADE_MS = 60 * 60_000;
const MAX_ATRASO_MS = 6 * 3600_000;

/**
 * Previsão do tempo pelo Open-Meteo (gratuito, sem chave, uso não comercial, dados CC BY 4.0). Guarda a última
 * consulta de cada célula de grade por até 1 h (os modelos que cobrem o Brasil atualizam a cada 1 a 6 h), e grava o
 * histórico hora a hora e a previsão feita ~24 h antes de cada hora (para o gráfico "previsto × ocorrido").
 */
export class OpenMeteo {
  constructor(
    private readonly sql: FitaSql,
    private readonly baseUrl = 'https://api.open-meteo.com/v1/forecast',
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async previsao(celula: string): Promise<Previsao> {
    const guardada = this.sql.get<{ consultado_em: string; dados: string }>('SELECT consultado_em, dados FROM previsoes WHERE celula = ?', celula);
    const idade = guardada ? this.agora().getTime() - Date.parse(guardada.consultado_em) : Infinity;
    if (guardada && idade < MAX_IDADE_MS) return JSON.parse(guardada.dados) as Previsao;
    try {
      const previsao = await this.consultar(celula);
      this.guardar(previsao);
      return previsao;
    } catch (error) {
      if (guardada && idade < MAX_ATRASO_MS) return { ...(JSON.parse(guardada.dados) as Previsao), desatualizada: true };
      throw new UserFacingError('Não consegui buscar a previsão do tempo agora (Open-Meteo fora do ar). Tente de novo daqui a pouco.', errorMessage(error), { cause: error });
    }
  }

  private async consultar(celula: string): Promise<Previsao> {
    const [lat, lon] = celula.split(',');
    const params = new URLSearchParams({
      latitude: lat!,
      longitude: lon!,
      timezone: 'auto',
      forecast_days: '16',
      past_days: '7',
      wind_speed_unit: 'kmh',
      hourly: HOURLY.join(','),
      daily: DAILY.join(','),
      current: CURRENT.join(','),
    });
    const response = await fetch(`${this.baseUrl}?${params}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Open-Meteo respondeu ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const body = (await response.json()) as { timezone: string; utc_offset_seconds: number; current: Record<string, number | string>; hourly: Previsao['horas']; daily: Previsao['dias'] };
    return { celula, timezone: body.timezone, utcOffsetSeconds: body.utc_offset_seconds, consultadoEm: this.agora().toISOString(), atual: body.current, horas: body.hourly, dias: body.daily };
  }

  private guardar(p: Previsao): void {
    const agoraLocal = horaLocal(this.agora(), p.utcOffsetSeconds);
    this.sql.transacao(() => {
      this.sql.run(
        `INSERT INTO previsoes (celula, consultado_em, dados) VALUES (?, ?, ?)
         ON CONFLICT(celula) DO UPDATE SET consultado_em = excluded.consultado_em, dados = excluded.dados`,
        p.celula, p.consultadoEm, JSON.stringify(p),
      );
      const h = p.horas;
      h.time.forEach((hora, i) => {
        if (hora <= agoraLocal) {
          // Horas que já passaram: o "ocorrido" (análise do modelo), para os gráficos e o balanço de água.
          this.sql.run(
            `INSERT OR REPLACE INTO historico (celula, hora, temperatura, umidade, chuva, vento, rajada, et0, vpd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            p.celula, hora, h.temperature_2m?.[i] ?? null, h.relative_humidity_2m?.[i] ?? null, h.precipitation?.[i] ?? null,
            h.wind_speed_10m?.[i] ?? null, h.wind_gusts_10m?.[i] ?? null, h.et0_fao_evapotranspiration?.[i] ?? null, h.vapour_pressure_deficit?.[i] ?? null,
          );
        } else if (hora >= somarHoras(agoraLocal, 23) && hora <= somarHoras(agoraLocal, 25)) {
          // Previsão feita ~24 h antes da hora (a primeira que gravar fica), para comparar com o que aconteceu.
          this.sql.run(
            'INSERT OR IGNORE INTO previsto (celula, hora, feito_em, temperatura, chuva, probabilidade) VALUES (?, ?, ?, ?, ?, ?)',
            p.celula, hora, p.consultadoEm, h.temperature_2m?.[i] ?? null, h.precipitation?.[i] ?? null, h.precipitation_probability?.[i] ?? null,
          );
        }
      });
    });
  }
}

/** "2026-10-30T14:00" no fuso do lugar. */
export function horaLocal(data: Date, utcOffsetSeconds: number): string {
  return new Date(data.getTime() + utcOffsetSeconds * 1000).toISOString().slice(0, 13) + ':00';
}

export function somarHoras(horaLocalIso: string, horas: number): string {
  return new Date(Date.parse(`${horaLocalIso}:00Z`) + horas * 3600_000).toISOString().slice(0, 13) + ':00';
}
