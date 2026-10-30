import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FitaSql } from '../k7.js';

const scryptAsync = promisify(scrypt) as (senha: string, sal: Buffer, tamanho: number) => Promise<Buffer>;

export type Papel = 'admin' | 'leitura';

export interface Admin {
  email: string;
  nome: string;
  papel: Papel;
  criadoEm: string;
}

/** Contas do painel administrativo (senha guardada só como hash scrypt com sal). */
export class Admins {
  constructor(private readonly sql: FitaSql) {
    sql.exec(`CREATE TABLE IF NOT EXISTS administradores (
      email TEXT PRIMARY KEY, nome TEXT NOT NULL, papel TEXT NOT NULL CHECK (papel IN ('admin', 'leitura')),
      hash TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  listar(): Admin[] {
    return this.sql.all<{ email: string; nome: string; papel: Papel; criado_em: string }>('SELECT email, nome, papel, criado_em FROM administradores ORDER BY criado_em').map((r) => ({ email: r.email, nome: r.nome, papel: r.papel, criadoEm: r.criado_em }));
  }

  async criar(email: string, nome: string, senha: string, papel: Papel): Promise<Admin> {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('E-mail inválido');
    if (senha.length < 8) throw new Error('A senha precisa de pelo menos 8 caracteres');
    const sal = randomBytes(16);
    const hash = await scryptAsync(senha, sal, 32);
    this.sql.run(
      `INSERT INTO administradores (email, nome, papel, hash) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET nome = excluded.nome, papel = excluded.papel, hash = excluded.hash`,
      e, nome.trim() || e, papel, `${sal.toString('hex')}:${hash.toString('hex')}`,
    );
    return this.listar().find((a) => a.email === e)!;
  }

  remover(email: string): boolean {
    return this.sql.run('DELETE FROM administradores WHERE email = ?', email.trim().toLowerCase()).changes > 0;
  }

  /** Confere a senha (tempo constante); devolve a conta ou `undefined`. */
  async conferir(email: string, senha: string): Promise<Admin | undefined> {
    const row = this.sql.get<{ email: string; nome: string; papel: Papel; hash: string; criado_em: string }>('SELECT * FROM administradores WHERE email = ?', email.trim().toLowerCase());
    // Mesmo sem a conta, calcula um hash: o tempo de resposta não revela quais e-mails existem.
    const [salHex, hashHex] = (row?.hash ?? `${'0'.repeat(32)}:${'0'.repeat(64)}`).split(':');
    const calculado = await scryptAsync(senha, Buffer.from(salHex!, 'hex'), 32);
    const certo = timingSafeEqual(calculado, Buffer.from(hashHex!, 'hex'));
    return row && certo ? { email: row.email, nome: row.nome, papel: row.papel, criadoEm: row.criado_em } : undefined;
  }
}
