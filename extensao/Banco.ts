import type { FitaSql } from './k7.js';

export type ModoEnvio = 'boletim' | 'hora' | 'alertas' | 'pedir';
export type Severidade = 'info' | 'atencao' | 'grave';

export interface Lugar {
  userId: string;
  nome: string;
  lat: number;
  lon: number;
  /** Célula de grade (0,1°): lugares próximos dividem a mesma previsão. */
  celula: string;
  /** Sigla do estado (da localização): ajuda a achar o município no zoneamento (ZARC). */
  uf: string | null;
  atualizadoEm: string;
}

/** Uma planta de uma pessoa (ela pode ter várias: soja e milho, ou alface, cebola e banana no quintal). */
export interface Lavoura {
  id: number;
  userId: string;
  /** Planta de regras/plantas.yaml (ex.: alface, milho). */
  planta: string;
  /** Cultura de regras/culturas.yaml (fases e Kc). */
  cultura: string;
  /** Fase informada; com a data de plantio, a fase de hoje sai do ciclo (Plantas.faseAtual). */
  fase: string;
  irrigada: boolean;
  /** Última vez que a pessoa disse "irriguei" (zera o balanço de água). */
  irrigouEm: string | null;
  /** Data de plantio (AAAA-MM-DD), quando a pessoa contou. */
  plantio: string | null;
  /** Escolhida, mas ainda falta perguntar quando plantou (ou a fase). */
  pendente: boolean;
  atualizadoEm: string;
}

export interface Preferencias {
  userId: string;
  modo: ModoEnvio;
  /** Horas locais do boletim (ex.: [6, 18]). */
  horarios: number[];
  pausado: boolean;
}

export interface Envio {
  id: number;
  userId: string;
  quando: string;
  tipo: 'boletim' | 'alerta' | 'resposta' | 'teste';
  regras: string[];
  severidade: Severidade | null;
  texto: string;
  entregue: boolean;
  erro: string | null;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS lugares (
    user_id TEXT PRIMARY KEY, nome TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, celula TEXT NOT NULL, uf TEXT,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS lavouras (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, planta TEXT NOT NULL, cultura TEXT NOT NULL,
    fase TEXT NOT NULL, irrigada INTEGER NOT NULL DEFAULT 0, irrigou_em TEXT, plantio TEXT, pendente INTEGER NOT NULL DEFAULT 0,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (user_id, planta)
  );
  CREATE TABLE IF NOT EXISTS preferencias (
    user_id TEXT PRIMARY KEY, modo TEXT NOT NULL DEFAULT 'boletim', horarios TEXT NOT NULL DEFAULT '[6,18]',
    pausado INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS envios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, quando TEXT NOT NULL DEFAULT (datetime('now')),
    tipo TEXT NOT NULL, regras TEXT NOT NULL DEFAULT '[]', severidade TEXT, texto TEXT NOT NULL,
    entregue INTEGER NOT NULL, erro TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_envios_user ON envios (user_id, id);
  CREATE TABLE IF NOT EXISTS avisados (
    user_id TEXT NOT NULL, chave TEXT NOT NULL, severidade TEXT NOT NULL, quando TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, chave)
  );
  CREATE TABLE IF NOT EXISTS previsoes (celula TEXT PRIMARY KEY, consultado_em TEXT NOT NULL, dados TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS historico (
    celula TEXT NOT NULL, hora TEXT NOT NULL, temperatura REAL, umidade REAL, chuva REAL, vento REAL, rajada REAL,
    et0 REAL, vpd REAL, PRIMARY KEY (celula, hora)
  );
  CREATE TABLE IF NOT EXISTS previsto (
    celula TEXT NOT NULL, hora TEXT NOT NULL, feito_em TEXT NOT NULL, temperatura REAL, chuva REAL, probabilidade REAL,
    PRIMARY KEY (celula, hora)
  );
`;

/** Célula de grade de 0,1° (~11 km): quem está perto divide a mesma consulta ao Open-Meteo. */
export function celulaDe(lat: number, lon: number): string {
  return `${lat.toFixed(1)},${lon.toFixed(1)}`;
}

/** Tabelas da AgroMinds no banco próprio da fita (k7.sql). */
export class Banco {
  constructor(private readonly sql: FitaSql) {
    // Versão 0.2 (uma lavoura por pessoa, sem planta): vira a primeira planta de cada pessoa.
    const antigas = sql.all<{ name: string }>('PRAGMA table_info(lavouras)').map((c) => c.name);
    const migrar = antigas.length > 0 && !antigas.includes('planta');
    if (migrar) sql.exec('ALTER TABLE lavouras RENAME TO lavouras_v1');
    sql.exec(SCHEMA);
    if (migrar) {
      sql.exec(`INSERT INTO lavouras (user_id, planta, cultura, fase, irrigada, irrigou_em, atualizado_em)
        SELECT user_id, cultura, cultura, fase, irrigada, irrigou_em, atualizado_em FROM lavouras_v1; DROP TABLE lavouras_v1;`);
    }
    if (!sql.all<{ name: string }>('PRAGMA table_info(lugares)').some((c) => c.name === 'uf')) sql.exec('ALTER TABLE lugares ADD COLUMN uf TEXT');
  }

  /** `uf` vem do endereço da localização; sem ele, sai do nome ("Goiânia/GO"). */
  salvarLugar(userId: string, nome: string, lat: number, lon: number, uf?: string | null): Lugar {
    // Só 2 casas (~1 km): o suficiente para o tempo, sem guardar a coordenada exata da pessoa.
    const la = Math.round(lat * 100) / 100;
    const lo = Math.round(lon * 100) / 100;
    const sigla = uf ?? /\/([A-Z]{2})$/.exec(nome)?.[1] ?? null;
    this.sql.run(
      `INSERT INTO lugares (user_id, nome, lat, lon, celula, uf) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET nome = excluded.nome, lat = excluded.lat, lon = excluded.lon, celula = excluded.celula, uf = excluded.uf, atualizado_em = datetime('now')`,
      userId, nome, la, lo, celulaDe(la, lo), sigla,
    );
    return this.lugar(userId)!;
  }

  lugar(userId: string): Lugar | undefined {
    const r = this.sql.get<LugarRow>('SELECT * FROM lugares WHERE user_id = ?', userId);
    return r && toLugar(r);
  }

  lugares(): Lugar[] {
    return this.sql.all<LugarRow>('SELECT * FROM lugares ORDER BY atualizado_em DESC').map(toLugar);
  }

  /** Cria ou muda uma planta da pessoa (o que não vier em `dados` fica como estava). */
  salvarLavoura(userId: string, planta: string, dados: Partial<Pick<Lavoura, 'cultura' | 'fase' | 'irrigada' | 'plantio' | 'pendente'>> = {}): Lavoura {
    const atual = this.lavoura(userId, planta);
    const l = {
      cultura: dados.cultura ?? atual?.cultura ?? planta,
      fase: dados.fase ?? atual?.fase ?? 'vegetativo',
      irrigada: dados.irrigada ?? atual?.irrigada ?? false,
      plantio: dados.plantio !== undefined ? dados.plantio : (atual?.plantio ?? null),
      pendente: dados.pendente ?? atual?.pendente ?? false,
    };
    this.sql.run(
      `INSERT INTO lavouras (user_id, planta, cultura, fase, irrigada, plantio, pendente) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, planta) DO UPDATE SET cultura = excluded.cultura, fase = excluded.fase, irrigada = excluded.irrigada,
         plantio = excluded.plantio, pendente = excluded.pendente, atualizado_em = datetime('now')`,
      userId, planta, l.cultura, l.fase, l.irrigada ? 1 : 0, l.plantio, l.pendente ? 1 : 0,
    );
    return this.lavoura(userId, planta)!;
  }

  removerLavoura(userId: string, planta: string): void {
    this.sql.run('DELETE FROM lavouras WHERE user_id = ? AND planta = ?', userId, planta);
  }

  /** "Irriguei": zera a conta de água de uma planta ou, sem `planta`, de todas as irrigadas. */
  irrigou(userId: string, planta?: string): void {
    if (planta) this.sql.run("UPDATE lavouras SET irrigou_em = datetime('now') WHERE user_id = ? AND planta = ?", userId, planta);
    else this.sql.run("UPDATE lavouras SET irrigou_em = datetime('now') WHERE user_id = ? AND irrigada = 1", userId);
  }

  lavoura(userId: string, planta: string): Lavoura | undefined {
    const r = this.sql.get<LavouraRow>('SELECT * FROM lavouras WHERE user_id = ? AND planta = ?', userId, planta);
    return r && toLavoura(r);
  }

  /** As plantas da pessoa, na ordem em que foram escolhidas. */
  lavouras(userId: string): Lavoura[] {
    return this.sql.all<LavouraRow>('SELECT * FROM lavouras WHERE user_id = ? ORDER BY id', userId).map(toLavoura);
  }

  preferencias(userId: string): Preferencias {
    const r = this.sql.get<{ modo: ModoEnvio; horarios: string; pausado: number }>('SELECT * FROM preferencias WHERE user_id = ?', userId);
    return { userId, modo: r?.modo ?? 'boletim', horarios: r ? (JSON.parse(r.horarios) as number[]) : [6, 18], pausado: r?.pausado === 1 };
  }

  salvarPreferencias(userId: string, dados: Partial<Omit<Preferencias, 'userId'>>): Preferencias {
    const atual = this.preferencias(userId);
    const p = { ...atual, ...dados };
    this.sql.run(
      `INSERT INTO preferencias (user_id, modo, horarios, pausado) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET modo = excluded.modo, horarios = excluded.horarios, pausado = excluded.pausado`,
      userId, p.modo, JSON.stringify(p.horarios), p.pausado ? 1 : 0,
    );
    return this.preferencias(userId);
  }

  registrarEnvio(e: Omit<Envio, 'id' | 'quando'>): void {
    this.sql.run(
      'INSERT INTO envios (user_id, tipo, regras, severidade, texto, entregue, erro) VALUES (?, ?, ?, ?, ?, ?, ?)',
      e.userId, e.tipo, JSON.stringify(e.regras), e.severidade, e.texto, e.entregue ? 1 : 0, e.erro,
    );
  }

  envios(filtro: { userId?: string; tipo?: string; desde?: string; ate?: string; busca?: string; limite?: number } = {}): Envio[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filtro.userId) where.push('user_id = ?') && params.push(filtro.userId);
    if (filtro.tipo) where.push('tipo = ?') && params.push(filtro.tipo);
    if (filtro.desde) where.push('quando >= ?') && params.push(filtro.desde);
    if (filtro.ate) where.push('quando <= ?') && params.push(filtro.ate);
    if (filtro.busca) where.push('texto LIKE ?') && params.push(`%${filtro.busca}%`);
    const rows = this.sql.all<{ id: number; user_id: string; quando: string; tipo: Envio['tipo']; regras: string; severidade: Severidade | null; texto: string; entregue: number; erro: string | null }>(
      `SELECT * FROM envios ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
      ...params,
      Math.min(1000, filtro.limite ?? 200),
    );
    return rows.map((r) => ({ id: r.id, userId: r.user_id, quando: r.quando, tipo: r.tipo, regras: JSON.parse(r.regras) as string[], severidade: r.severidade, texto: r.texto, entregue: r.entregue === 1, erro: r.erro }));
  }

  /** Já avisou esta chave (regra + dia) com esta severidade ou maior? */
  jaAvisado(userId: string, chave: string, severidade: Severidade): boolean {
    const r = this.sql.get<{ severidade: Severidade }>('SELECT severidade FROM avisados WHERE user_id = ? AND chave = ?', userId, chave);
    return r !== undefined && PESO[r.severidade] >= PESO[severidade];
  }

  marcarAvisado(userId: string, chave: string, severidade: Severidade): void {
    this.sql.run(
      `INSERT INTO avisados (user_id, chave, severidade) VALUES (?, ?, ?)
       ON CONFLICT(user_id, chave) DO UPDATE SET severidade = excluded.severidade, quando = datetime('now')`,
      userId, chave, severidade,
    );
  }

  /** `/esquecer`: apaga tudo da pessoa nesta fita. */
  esquecer(userId: string): void {
    this.sql.transacao(() => {
      for (const tabela of ['lugares', 'lavouras', 'preferencias', 'envios', 'avisados']) this.sql.run(`DELETE FROM ${tabela} WHERE user_id = ?`, userId);
    });
  }

  /** Apaga o que passou do prazo: previsões guardadas (90 dias) e envios/histórico (1 ano). */
  limpar(): void {
    this.sql.run("DELETE FROM previsto WHERE hora < datetime('now', '-90 days')");
    this.sql.run("DELETE FROM historico WHERE hora < datetime('now', '-365 days')");
    this.sql.run("DELETE FROM envios WHERE quando < datetime('now', '-365 days')");
    this.sql.run("DELETE FROM avisados WHERE quando < datetime('now', '-30 days')");
  }
}

export const PESO: Record<Severidade, number> = { info: 0, atencao: 1, grave: 2 };

interface LugarRow {
  user_id: string;
  nome: string;
  lat: number;
  lon: number;
  celula: string;
  uf: string | null;
  atualizado_em: string;
}

const toLugar = (r: LugarRow): Lugar => ({ userId: r.user_id, nome: r.nome, lat: r.lat, lon: r.lon, celula: r.celula, uf: r.uf ?? null, atualizadoEm: r.atualizado_em });

interface LavouraRow {
  id: number;
  user_id: string;
  planta: string;
  cultura: string;
  fase: string;
  irrigada: number;
  irrigou_em: string | null;
  plantio: string | null;
  pendente: number;
  atualizado_em: string;
}

const toLavoura = (r: LavouraRow): Lavoura => ({
  id: r.id,
  userId: r.user_id,
  planta: r.planta,
  cultura: r.cultura,
  fase: r.fase,
  irrigada: r.irrigada === 1,
  irrigouEm: r.irrigou_em,
  plantio: r.plantio,
  pendente: r.pendente === 1,
  atualizadoEm: r.atualizado_em,
});
