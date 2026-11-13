import type { FitaSql } from './k7.js';

export type ModoEnvio = 'boletim' | 'hora' | 'alertas' | 'pedir';
export type Severidade = 'info' | 'atencao' | 'grave';

/**
 * Um lugar onde a pessoa planta (ela pode ter vários: a fazenda, o sítio, a horta de casa). Não precisa ser onde ela
 * está: no Telegram dá para arrastar o mapa ao mandar a localização; no chat web, buscar a cidade ou colar a coordenada.
 */
export interface Lugar {
  id: number;
  userId: string;
  /** Como aparece: "Sítio Boa Vista (Goiânia/GO)", ou só a cidade quando não tem apelido. */
  nome: string;
  /** Nome que a pessoa deu ("Sítio Boa Vista"); null = só a cidade. */
  apelido: string | null;
  /** Município da coordenada ("Goiânia/GO"), ou a coordenada quando não deu para saber. */
  cidade: string;
  /** O lugar em uso: comandos e perguntas sem lugar falam dele. */
  atual: boolean;
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
  /** Lugar onde está plantada. */
  lugarId: number;
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
  /** Boletim e alertas também em áudio (mensagem de voz depois da imagem). */
  audio: boolean;
}

/** O que a pessoa anota no caderno de campo (pela conversa, inclusive por áudio). */
export type TipoAnotacao = 'aplicacao' | 'adubacao' | 'irrigacao' | 'plantio' | 'colheita' | 'chuva' | 'observacao' | 'outro';

export interface Anotacao {
  id: number;
  userId: string;
  lugarId: number;
  /** Dia do que aconteceu (AAAA-MM-DD), não o da anotação. */
  dia: string;
  tipo: TipoAnotacao;
  texto: string;
  planta: string | null;
  quantidade: number | null;
  unidade: string | null;
  registradoEm: string;
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
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, apelido TEXT, cidade TEXT NOT NULL, lat REAL NOT NULL,
    lon REAL NOT NULL, celula TEXT NOT NULL, uf TEXT, atual INTEGER NOT NULL DEFAULT 0,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_lugares_user ON lugares (user_id, id);
  CREATE TABLE IF NOT EXISTS lavouras (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, lugar_id INTEGER NOT NULL, planta TEXT NOT NULL,
    cultura TEXT NOT NULL, fase TEXT NOT NULL, irrigada INTEGER NOT NULL DEFAULT 0, irrigou_em TEXT, plantio TEXT,
    pendente INTEGER NOT NULL DEFAULT 0, atualizado_em TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (lugar_id, planta)
  );
  CREATE TABLE IF NOT EXISTS preferencias (
    user_id TEXT PRIMARY KEY, modo TEXT NOT NULL DEFAULT 'boletim', horarios TEXT NOT NULL DEFAULT '[6,18]',
    pausado INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS chuva_medida (
    lugar_id INTEGER NOT NULL, dia TEXT NOT NULL, user_id TEXT NOT NULL, mm REAL NOT NULL,
    registrado_em TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (lugar_id, dia)
  );
  CREATE TABLE IF NOT EXISTS caderno (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, lugar_id INTEGER NOT NULL, dia TEXT NOT NULL,
    tipo TEXT NOT NULL, texto TEXT NOT NULL, planta TEXT, quantidade REAL, unidade TEXT,
    registrado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_caderno_lugar ON caderno (user_id, lugar_id, dia);
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
    // Versões antigas: 0.2 (uma lavoura por pessoa, sem planta), 0.3 (plantas sem lugar) e um lugar por pessoa.
    const colunas = (tabela: string) => sql.all<{ name: string }>(`PRAGMA table_info(${tabela})`).map((c) => c.name);
    const lavouras = colunas('lavouras');
    const lugares = colunas('lugares');
    const v1 = lavouras.length > 0 && !lavouras.includes('planta');
    const v2 = lavouras.length > 0 && lavouras.includes('planta') && !lavouras.includes('lugar_id');
    const umLugar = lugares.length > 0 && !lugares.includes('id');
    if (v1) sql.exec('ALTER TABLE lavouras RENAME TO lavouras_v1');
    if (v2) sql.exec('ALTER TABLE lavouras RENAME TO lavouras_v2');
    if (umLugar) sql.exec('ALTER TABLE lugares RENAME TO lugares_v1');
    sql.exec(SCHEMA);
    if (!colunas('preferencias').includes('audio')) sql.exec('ALTER TABLE preferencias ADD COLUMN audio INTEGER NOT NULL DEFAULT 0');
    sql.transacao(() => {
      if (umLugar) {
        const uf = lugares.includes('uf') ? 'uf' : 'NULL';
        sql.exec(`INSERT INTO lugares (user_id, cidade, lat, lon, celula, uf, atual, atualizado_em)
          SELECT user_id, nome, lat, lon, celula, ${uf}, 1, atualizado_em FROM lugares_v1; DROP TABLE lugares_v1;`);
      }
      const lugarDe = '(SELECT id FROM lugares l WHERE l.user_id = v.user_id AND l.atual = 1)';
      if (v1) {
        sql.exec(`INSERT INTO lavouras (user_id, lugar_id, planta, cultura, fase, irrigada, irrigou_em, atualizado_em)
          SELECT user_id, ${lugarDe}, cultura, cultura, fase, irrigada, irrigou_em, atualizado_em FROM lavouras_v1 v WHERE ${lugarDe} IS NOT NULL;
          DROP TABLE lavouras_v1;`);
      }
      if (v2) {
        sql.exec(`INSERT INTO lavouras (user_id, lugar_id, planta, cultura, fase, irrigada, irrigou_em, plantio, pendente, atualizado_em)
          SELECT user_id, ${lugarDe}, planta, cultura, fase, irrigada, irrigou_em, plantio, pendente, atualizado_em FROM lavouras_v2 v WHERE ${lugarDe} IS NOT NULL;
          DROP TABLE lavouras_v2;`);
      }
    });
  }

  /**
   * Novo lugar (ou, com `id`, muda a coordenada de um que já existe), e ele passa a ser o atual. `uf` vem do endereço
   * da localização; sem ele, sai da cidade ("Goiânia/GO").
   */
  salvarLugar(userId: string, cidade: string, lat: number, lon: number, uf?: string | null, opcoes: { id?: number; apelido?: string | null } = {}): Lugar {
    // Só 2 casas (~1 km): o suficiente para o tempo, sem guardar a coordenada exata.
    const la = Math.round(lat * 100) / 100;
    const lo = Math.round(lon * 100) / 100;
    const sigla = uf ?? /\/([A-Z]{2})$/.exec(cidade)?.[1] ?? null;
    const existente = opcoes.id !== undefined ? this.lugarPorId(userId, opcoes.id) : undefined;
    let id: number;
    if (existente) {
      this.sql.run(
        "UPDATE lugares SET cidade = ?, lat = ?, lon = ?, celula = ?, uf = ?, apelido = COALESCE(?, apelido), atualizado_em = datetime('now') WHERE id = ?",
        cidade, la, lo, celulaDe(la, lo), sigla, opcoes.apelido ?? null, existente.id,
      );
      id = existente.id;
    } else {
      id = Number(this.sql.run('INSERT INTO lugares (user_id, apelido, cidade, lat, lon, celula, uf) VALUES (?, ?, ?, ?, ?, ?, ?)', userId, opcoes.apelido?.trim() || null, cidade, la, lo, celulaDe(la, lo), sigla).lastInsertRowid);
    }
    this.usarLugar(userId, id);
    return this.lugarPorId(userId, id)!;
  }

  /** O lugar atual da pessoa (o último escolhido). */
  lugar(userId: string): Lugar | undefined {
    const r = this.sql.get<LugarRow>('SELECT * FROM lugares WHERE user_id = ? ORDER BY atual DESC, id DESC LIMIT 1', userId);
    return r && toLugar(r);
  }

  lugarPorId(userId: string, id: number): Lugar | undefined {
    const r = this.sql.get<LugarRow>('SELECT * FROM lugares WHERE user_id = ? AND id = ?', userId, id);
    return r && toLugar(r);
  }

  /** Os lugares da pessoa, na ordem em que foram cadastrados. */
  lugaresDe(userId: string): Lugar[] {
    return this.sql.all<LugarRow>('SELECT * FROM lugares WHERE user_id = ? ORDER BY id', userId).map(toLugar);
  }

  /** Todos os lugares de todo mundo (notificações, mapa do painel). */
  todosLugares(): Lugar[] {
    return this.sql.all<LugarRow>('SELECT * FROM lugares ORDER BY user_id, id').map(toLugar);
  }

  usarLugar(userId: string, id: number): boolean {
    if (!this.lugarPorId(userId, id)) return false;
    this.sql.run('UPDATE lugares SET atual = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE user_id = ?', id, userId);
    return true;
  }

  renomearLugar(userId: string, id: number, apelido: string | null): boolean {
    return this.sql.run('UPDATE lugares SET apelido = ? WHERE user_id = ? AND id = ?', apelido?.trim().slice(0, 40) || null, userId, id).changes > 0;
  }

  /** Apaga o lugar e as plantas dele; se era o atual, o mais recente que sobrou vira o atual. */
  removerLugar(userId: string, id: number): boolean {
    const era = this.lugarPorId(userId, id);
    if (!era) return false;
    this.sql.transacao(() => {
      this.sql.run('DELETE FROM lavouras WHERE user_id = ? AND lugar_id = ?', userId, id);
      this.sql.run('DELETE FROM chuva_medida WHERE user_id = ? AND lugar_id = ?', userId, id);
      this.sql.run('DELETE FROM caderno WHERE user_id = ? AND lugar_id = ?', userId, id);
      this.sql.run('DELETE FROM lugares WHERE user_id = ? AND id = ?', userId, id);
    });
    const resto = this.lugaresDe(userId).at(-1);
    if (era.atual && resto) this.usarLugar(userId, resto.id);
    return true;
  }

  private lugarIdDe(userId: string, lugarId?: number): number {
    const id = lugarId ?? this.lugar(userId)?.id;
    if (id === undefined) throw new Error('essa pessoa ainda não tem um lugar cadastrado');
    return id;
  }

  /** Cria ou muda uma planta num lugar da pessoa (padrão: o atual); o que não vier em `dados` fica como estava. */
  salvarLavoura(userId: string, planta: string, dados: Partial<Pick<Lavoura, 'cultura' | 'fase' | 'irrigada' | 'plantio' | 'pendente'>> = {}, lugarId?: number): Lavoura {
    const lugar = this.lugarIdDe(userId, lugarId);
    const atual = this.lavoura(userId, planta, lugar);
    const l = {
      cultura: dados.cultura ?? atual?.cultura ?? planta,
      fase: dados.fase ?? atual?.fase ?? 'vegetativo',
      irrigada: dados.irrigada ?? atual?.irrigada ?? false,
      plantio: dados.plantio !== undefined ? dados.plantio : (atual?.plantio ?? null),
      pendente: dados.pendente ?? atual?.pendente ?? false,
    };
    this.sql.run(
      `INSERT INTO lavouras (user_id, lugar_id, planta, cultura, fase, irrigada, plantio, pendente) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lugar_id, planta) DO UPDATE SET cultura = excluded.cultura, fase = excluded.fase, irrigada = excluded.irrigada,
         plantio = excluded.plantio, pendente = excluded.pendente, atualizado_em = datetime('now')`,
      userId, lugar, planta, l.cultura, l.fase, l.irrigada ? 1 : 0, l.plantio, l.pendente ? 1 : 0,
    );
    return this.lavoura(userId, planta, lugar)!;
  }

  removerLavoura(userId: string, planta: string, lugarId?: number): void {
    const lugar = lugarId ?? this.lugar(userId)?.id;
    if (lugar !== undefined) this.sql.run('DELETE FROM lavouras WHERE user_id = ? AND lugar_id = ? AND planta = ?', userId, lugar, planta);
  }

  /** "Irriguei": zera a conta de água de uma planta ou, sem `planta`, de todas as irrigadas do lugar (padrão: o atual). */
  irrigou(userId: string, planta?: string, lugarId?: number): void {
    const lugar = lugarId ?? this.lugar(userId)?.id;
    if (lugar === undefined) return;
    if (planta) this.sql.run("UPDATE lavouras SET irrigou_em = datetime('now') WHERE user_id = ? AND lugar_id = ? AND planta = ?", userId, lugar, planta);
    else this.sql.run("UPDATE lavouras SET irrigou_em = datetime('now') WHERE user_id = ? AND lugar_id = ? AND irrigada = 1", userId, lugar);
  }

  lavoura(userId: string, planta: string, lugarId?: number): Lavoura | undefined {
    const lugar = lugarId ?? this.lugar(userId)?.id;
    if (lugar === undefined) return undefined;
    const r = this.sql.get<LavouraRow>('SELECT * FROM lavouras WHERE user_id = ? AND lugar_id = ? AND planta = ?', userId, lugar, planta);
    return r && toLavoura(r);
  }

  /** As plantas de um lugar da pessoa (padrão: o atual), na ordem em que foram escolhidas. */
  lavouras(userId: string, lugarId?: number): Lavoura[] {
    const lugar = lugarId ?? this.lugar(userId)?.id;
    if (lugar === undefined) return [];
    return this.sql.all<LavouraRow>('SELECT * FROM lavouras WHERE user_id = ? AND lugar_id = ? ORDER BY id', userId, lugar).map(toLavoura);
  }

  preferencias(userId: string): Preferencias {
    const r = this.sql.get<{ modo: ModoEnvio; horarios: string; pausado: number; audio: number }>('SELECT * FROM preferencias WHERE user_id = ?', userId);
    return { userId, modo: r?.modo ?? 'boletim', horarios: r ? (JSON.parse(r.horarios) as number[]) : [6, 18], pausado: r?.pausado === 1, audio: r?.audio === 1 };
  }

  salvarPreferencias(userId: string, dados: Partial<Omit<Preferencias, 'userId'>>): Preferencias {
    const atual = this.preferencias(userId);
    const p = { ...atual, ...dados };
    this.sql.run(
      `INSERT INTO preferencias (user_id, modo, horarios, pausado, audio) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET modo = excluded.modo, horarios = excluded.horarios, pausado = excluded.pausado,
         audio = excluded.audio`,
      userId, p.modo, JSON.stringify(p.horarios), p.pausado ? 1 : 0, p.audio ? 1 : 0,
    );
    return this.preferencias(userId);
  }

  /** Chuva do pluviômetro da pessoa num dia (substitui a estimativa do modelo nesse dia); mm < 0 apaga. */
  registrarChuva(userId: string, lugarId: number, dia: string, mm: number): void {
    if (mm < 0) return void this.sql.run('DELETE FROM chuva_medida WHERE user_id = ? AND lugar_id = ? AND dia = ?', userId, lugarId, dia);
    this.sql.run(
      `INSERT INTO chuva_medida (lugar_id, dia, user_id, mm) VALUES (?, ?, ?, ?)
       ON CONFLICT(lugar_id, dia) DO UPDATE SET mm = excluded.mm, registrado_em = datetime('now')`,
      lugarId, dia, userId, Math.round(mm * 10) / 10,
    );
  }

  /** Chuva medida num lugar a partir de `desde` (AAAA-MM-DD): { dia: mm }. */
  chuvaMedida(lugarId: number, desde = '0000-00-00'): Record<string, number> {
    const linhas = this.sql.all<{ dia: string; mm: number }>('SELECT dia, mm FROM chuva_medida WHERE lugar_id = ? AND dia >= ? ORDER BY dia', lugarId, desde);
    return Object.fromEntries(linhas.map((l) => [l.dia, l.mm]));
  }

  anotar(a: Omit<Anotacao, 'id' | 'registradoEm'>): Anotacao {
    const id = Number(
      this.sql.run(
        'INSERT INTO caderno (user_id, lugar_id, dia, tipo, texto, planta, quantidade, unidade) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        a.userId, a.lugarId, a.dia, a.tipo, a.texto.trim().slice(0, 500), a.planta, a.quantidade, a.unidade?.trim().slice(0, 20) || null,
      ).lastInsertRowid,
    );
    return this.caderno(a.userId, { lugarId: a.lugarId, id })[0]!;
  }

  /** Anotações do caderno, as mais recentes primeiro. */
  caderno(userId: string, filtro: { lugarId?: number; desde?: string; tipo?: TipoAnotacao; planta?: string; id?: number; limite?: number } = {}): Anotacao[] {
    const where = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (filtro.lugarId !== undefined) where.push('lugar_id = ?') && params.push(filtro.lugarId);
    if (filtro.desde) where.push('dia >= ?') && params.push(filtro.desde);
    if (filtro.tipo) where.push('tipo = ?') && params.push(filtro.tipo);
    if (filtro.planta) where.push('planta = ?') && params.push(filtro.planta);
    if (filtro.id !== undefined) where.push('id = ?') && params.push(filtro.id);
    const linhas = this.sql.all<{ id: number; user_id: string; lugar_id: number; dia: string; tipo: TipoAnotacao; texto: string; planta: string | null; quantidade: number | null; unidade: string | null; registrado_em: string }>(
      `SELECT * FROM caderno WHERE ${where.join(' AND ')} ORDER BY dia DESC, id DESC LIMIT ?`,
      ...params,
      Math.min(500, filtro.limite ?? 50),
    );
    return linhas.map((r) => ({ id: r.id, userId: r.user_id, lugarId: r.lugar_id, dia: r.dia, tipo: r.tipo, texto: r.texto, planta: r.planta, quantidade: r.quantidade, unidade: r.unidade, registradoEm: r.registrado_em }));
  }

  apagarAnotacao(userId: string, id: number): boolean {
    return this.sql.run('DELETE FROM caderno WHERE user_id = ? AND id = ?', userId, id).changes > 0;
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
      for (const tabela of ['lugares', 'lavouras', 'preferencias', 'envios', 'avisados', 'chuva_medida', 'caderno']) this.sql.run(`DELETE FROM ${tabela} WHERE user_id = ?`, userId);
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
  id: number;
  user_id: string;
  apelido: string | null;
  cidade: string;
  lat: number;
  lon: number;
  celula: string;
  uf: string | null;
  atual: number;
  atualizado_em: string;
}

const toLugar = (r: LugarRow): Lugar => ({
  id: r.id,
  userId: r.user_id,
  nome: r.apelido ? `${r.apelido} (${r.cidade})` : r.cidade,
  apelido: r.apelido,
  cidade: r.cidade,
  atual: r.atual === 1,
  lat: r.lat,
  lon: r.lon,
  celula: r.celula,
  uf: r.uf ?? null,
  atualizadoEm: r.atualizado_em,
});

interface LavouraRow {
  id: number;
  user_id: string;
  lugar_id: number;
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
  lugarId: r.lugar_id,
  planta: r.planta,
  cultura: r.cultura,
  fase: r.fase,
  irrigada: r.irrigada === 1,
  irrigouEm: r.irrigou_em,
  plantio: r.plantio,
  pendente: r.pendente === 1,
  atualizadoEm: r.atualizado_em,
});
