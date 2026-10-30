import readline from 'node:readline';
import { Readable } from 'node:stream';
import type { FitaSql } from './k7.js';

/** Conjunto de dados "Tábua de risco - ZARC" no portal de dados abertos do MAPA (CKAN). */
const DATASET = '6d3d141c-885e-41a4-ab7f-dc8ff323b96f';
const PORTAL = 'https://dados.agricultura.gov.br';
const UA = 'K7-AgroMinds/0.2 (projeto academico UFG)';

export type Solo = 'arenoso' | 'medio' | 'argiloso';
export type Manejo = 'Sequeiro' | 'Irrigado';

/** As 3 classes de solo, na ordem em que ficam guardadas (36 decêndios de cada). */
const SOLOS: Solo[] = ['arenoso', 'medio', 'argiloso'];
/** Códigos de solo do ZARC → classe (textura 1–3 ou água disponível AD1–AD6). */
const SOLO: Record<string, number> = { '1': 0, '11': 0, '12': 0, '2': 1, '13': 1, '14': 1, '3': 2, '15': 2, '16': 2 };

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS zarc_municipios (geocodigo TEXT PRIMARY KEY, uf TEXT NOT NULL, nome TEXT NOT NULL, chave TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_zarc_municipios_chave ON zarc_municipios (chave, uf);
  CREATE TABLE IF NOT EXISTS zarc_plantio (
    geocodigo TEXT NOT NULL, cultura TEXT NOT NULL, manejo TEXT NOT NULL, arquivo TEXT NOT NULL,
    risco TEXT NOT NULL,
    PRIMARY KEY (geocodigo, cultura, manejo, arquivo)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS zarc_arquivos (
    arquivo TEXT PRIMARY KEY, nome TEXT NOT NULL, url TEXT NOT NULL, importado_em TEXT NOT NULL DEFAULT (datetime('now')),
    linhas INTEGER NOT NULL, janelas INTEGER NOT NULL
  );
`;

/** Janela de plantio de uma cultura num município: o risco (20, 30 ou 40%) de cada um dos 36 decêndios; 0 = não indicado. */
export interface Janela {
  cultura: string;
  manejo: string;
  solo: Solo;
  risco: number[];
}

export interface ArquivoZarc {
  /** `safra` (grãos da safra atual) ou `perene` (perenes, olerícolas e sem safra). */
  arquivo: string;
  nome: string;
  url: string;
}

/** Nome sem acento, minúsculo e só com letras e números (para achar o município pelo nome do lugar). */
export function chaveDeNome(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Zoneamento Agrícola de Risco Climático (MAPA/Embrapa): as datas de plantio indicadas por município, cultura, solo,
 * ciclo e manejo, em decêndios. A tábua inteira tem ~750 MB; a fita guarda só as culturas do catálogo
 * (regras/plantas.yaml), resumidas por município, cultura e manejo — o risco de cada decêndio nas 3 classes de solo
 * (o menor entre os ciclos e as cultivares) num texto de 108 dígitos — e só baixa de novo quando sai uma safra nova
 * (ou, para as perenes, uma vez por ano).
 */
export class Zarc {
  constructor(
    private readonly sql: FitaSql,
    private readonly baixar: typeof fetch = fetch,
  ) {
    // Formato antigo (uma linha por solo, ~100 MB): sai, e a próxima atualização baixa de novo.
    if (sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'zarc_janelas'")?.n) {
      sql.exec('DROP TABLE zarc_janelas; DROP TABLE IF EXISTS zarc_arquivos;');
    }
    sql.exec(SCHEMA);
  }

  vazio(): boolean {
    return !this.sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM zarc_arquivos')?.n;
  }

  arquivos(): Array<ArquivoZarc & { importadoEm: string; linhas: number; janelas: number }> {
    return this.sql.all<{ arquivo: string; nome: string; url: string; importado_em: string; linhas: number; janelas: number }>('SELECT * FROM zarc_arquivos ORDER BY arquivo').map((a) => ({
      arquivo: a.arquivo,
      nome: a.nome,
      url: a.url,
      importadoEm: a.importado_em,
      linhas: a.linhas,
      janelas: a.janelas,
    }));
  }

  /** Arquivos atuais no portal: a safra mais recente que já começou e o de perenes/olerícolas. */
  async noPortal(agora = new Date()): Promise<ArquivoZarc[]> {
    const r = await this.baixar(`${PORTAL}/api/3/action/package_show?id=${DATASET}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`portal do MAPA respondeu ${r.status}`);
    const recursos = ((await r.json()) as { result: { resources: Array<{ name: string; url: string }> } }).result.resources;
    const safras = recursos
      .map((x) => ({ ...x, ano: Number(/Safra (\d{4})\/\d{4}/.exec(x.name)?.[1]) }))
      .filter((x) => x.ano && x.ano <= agora.getUTCFullYear())
      .sort((a, b) => b.ano - a.ano);
    const perene = recursos.find((x) => /Perene/i.test(x.name));
    return [
      ...(safras[0] ? [{ arquivo: 'safra', nome: safras[0].name, url: safras[0].url }] : []),
      ...(perene ? [{ arquivo: 'perene', nome: perene.name, url: perene.url }] : []),
    ];
  }

  /**
   * Confere o portal e importa o que mudou: safra nova, ou o arquivo de perenes com mais de um ano. Devolve o que
   * fez (vazio quando já estava em dia).
   */
  async atualizar(culturas: Set<string>, opcoes: { forcar?: boolean; agora?: Date } = {}): Promise<string[]> {
    const agora = opcoes.agora ?? new Date();
    const feitos: string[] = [];
    const atuais = new Map(this.arquivos().map((a) => [a.arquivo, a]));
    for (const alvo of await this.noPortal(agora)) {
      const atual = atuais.get(alvo.arquivo);
      const velho = atual && agora.getTime() - Date.parse(`${atual.importadoEm.replace(' ', 'T')}Z`) > 365 * 86400_000;
      if (!opcoes.forcar && atual && atual.url === alvo.url && !velho) continue;
      const r = await this.baixar(alvo.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30 * 60_000) });
      if (!r.ok || !r.body) throw new Error(`download de "${alvo.nome}" respondeu ${r.status}`);
      const linhas = readline.createInterface({ input: Readable.fromWeb(r.body as never), crlfDelay: Infinity });
      const n = await this.importar(linhas, culturas, alvo);
      feitos.push(`${alvo.nome}: ${n.linhas.toLocaleString('pt-BR')} linhas lidas, ${n.janelas.toLocaleString('pt-BR')} janelas guardadas`);
    }
    return feitos;
  }

  /** Lê o CSV (com o cabeçalho) e substitui o que veio antes deste mesmo arquivo. */
  async importar(linhas: AsyncIterable<string>, culturas: Set<string>, origem: ArquivoZarc): Promise<{ linhas: number; janelas: number }> {
    let col: Record<string, number> | undefined;
    let lidas = 0;
    // Os riscos ficam num bloco só (108 bytes por município × cultura × manejo): sem estourar a memória.
    const indice = new Map<string, number>();
    let riscos = new Uint8Array(108 * 32_768);
    const municipios = new Map<string, { uf: string; nome: string }>();
    for await (const linha of linhas) {
      const c = linha.split(';');
      if (!col) {
        col = Object.fromEntries(c.map((nome, i) => [nome.replace(/^﻿/, '').trim(), i]));
        for (const nome of ['Nome_cultura', 'Cod_Solo', 'geocodigo', 'UF', 'municipio', 'Nome_Outros_Manejos', 'dec1', 'dec36']) {
          if (col[nome] === undefined) throw new Error(`a tábua do ZARC não tem a coluna ${nome}`);
        }
        continue;
      }
      lidas++;
      const cultura = c[col.Nome_cultura!]?.trim() ?? '';
      if (!culturas.has(cultura)) continue;
      const solo = SOLO[c[col.Cod_Solo!]!];
      const geo = c[col.geocodigo!]!;
      if (solo === undefined || !geo) continue;
      municipios.set(geo, { uf: c[col.UF!]!, nome: c[col.municipio!]! });
      const dec1 = col.dec1!;
      // Linha sem nenhum decêndio indicado não acrescenta nada (o município continua conhecido).
      if (!c.slice(dec1, dec1 + 36).some((v) => v !== '0' && v !== '')) continue;
      const chave = `${geo}|${cultura}|${c[col.Nome_Outros_Manejos!]}`;
      let k = indice.get(chave);
      if (k === undefined) {
        k = indice.size;
        indice.set(chave, k);
        if ((k + 1) * 108 > riscos.length) {
          const maior = new Uint8Array(riscos.length * 2);
          maior.set(riscos);
          riscos = maior;
        }
      }
      const base = k * 108 + solo * 36;
      for (let i = 0; i < 36; i++) {
        const v = Number(c[dec1 + i]) / 10;
        const atual = riscos[base + i]!;
        if (v >= 1 && v <= 9 && (atual === 0 || v < atual)) riscos[base + i] = v;
      }
    }
    if (!col) throw new Error('arquivo do ZARC vazio');

    const entradas = [...indice];
    this.sql.run('DELETE FROM zarc_plantio WHERE arquivo = ?', origem.arquivo);
    // Em blocos: o bot continua respondendo enquanto grava.
    for (let i = 0; i < entradas.length; i += 20_000) {
      this.sql.transacao(() => {
        for (const [chave, k] of entradas.slice(i, i + 20_000)) {
          const [geo, cultura, manejo] = chave.split('|');
          const risco = Array.from(riscos.subarray(k * 108, k * 108 + 108)).join('');
          this.sql.run('INSERT OR REPLACE INTO zarc_plantio (geocodigo, cultura, manejo, arquivo, risco) VALUES (?, ?, ?, ?, ?)', geo, cultura, manejo, origem.arquivo, risco);
        }
      });
      await new Promise((r) => setImmediate(r));
    }
    this.sql.transacao(() => {
      for (const [geo, m] of municipios) this.sql.run('INSERT OR REPLACE INTO zarc_municipios (geocodigo, uf, nome, chave) VALUES (?, ?, ?, ?)', geo, m.uf, m.nome, chaveDeNome(m.nome));
      this.sql.run('INSERT OR REPLACE INTO zarc_arquivos (arquivo, nome, url, linhas, janelas) VALUES (?, ?, ?, ?, ?)', origem.arquivo, origem.nome, origem.url, lidas, entradas.length);
    });
    return { linhas: lidas, janelas: entradas.length };
  }

  /** Município pelo nome ("Goiânia") e UF; sem UF, só se o nome for único no país. */
  municipio(nome: string, uf: string | null): { geocodigo: string; nome: string; uf: string } | undefined {
    const achados = this.sql.all<{ geocodigo: string; nome: string; uf: string }>(
      `SELECT geocodigo, nome, uf FROM zarc_municipios WHERE chave = ?${uf ? ' AND uf = ?' : ''}`,
      ...[chaveDeNome(nome), ...(uf ? [uf] : [])],
    );
    return achados.length === 1 ? achados[0] : undefined;
  }

  /**
   * Janela de cada cultura no município, no manejo preferido (o outro, se não houver) e no solo pedido (se ele não
   * tiver janela, junta os outros). Quando a cultura vem dos dois arquivos, junta (o menor risco de cada decêndio).
   */
  janelas(geocodigo: string, culturas: string[], opcoes: { manejo?: Manejo; solo?: Solo } = {}): Janela[] {
    if (!culturas.length) return [];
    const linhas = this.sql.all<{ cultura: string; manejo: string; risco: string }>(
      `SELECT cultura, manejo, risco FROM zarc_plantio WHERE geocodigo = ? AND cultura IN (${culturas.map(() => '?').join(', ')})`,
      geocodigo,
      ...culturas,
    );
    const manejo = opcoes.manejo ?? 'Sequeiro';
    const solo = SOLOS.indexOf(opcoes.solo ?? 'medio');
    const out: Janela[] = [];
    for (const cultura of culturas) {
      const daCultura = linhas.filter((l) => l.cultura === cultura);
      if (!daCultura.length) continue;
      // Só ficam guardadas janelas com algum decêndio indicado: se o manejo preferido não tem (ex.: banana em
      // Goiânia só é indicada irrigada), vale o outro, e `manejo` diz qual.
      const doManejo = daCultura.some((l) => l.manejo === manejo) ? daCultura.filter((l) => l.manejo === manejo) : daCultura;
      const temSolo = (s: number) => doManejo.some((l) => /[1-9]/.test(l.risco.slice(s * 36, s * 36 + 36)));
      const solos = temSolo(solo) ? [solo] : [0, 1, 2].filter(temSolo);
      const risco = new Array<number>(36).fill(0);
      for (const l of doManejo) {
        for (const s of solos) {
          for (let i = 0; i < 36; i++) {
            const v = Number(l.risco[s * 36 + i]) * 10;
            if (v && (!risco[i] || v < risco[i]!)) risco[i] = v;
          }
        }
      }
      out.push({ cultura, manejo: doManejo[0]!.manejo, solo: SOLOS[solos[0] ?? solo]!, risco });
    }
    return out;
  }
}
