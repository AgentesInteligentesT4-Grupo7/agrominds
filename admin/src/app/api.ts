import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

export type Status = 'pendente' | 'ativo' | 'bloqueado';
export type Severidade = 'info' | 'atencao' | 'grave';
export type Modo = 'boletim' | 'hora' | 'alertas' | 'pedir';

export interface Admin {
  email: string;
  nome: string;
  papel: 'admin' | 'leitura';
  criadoEm: string;
}

export interface Usuario {
  userId: string;
  nome: string;
  username: string | null;
  status: Status;
  origem: string;
  criadoEm: string | null;
  ultimoContato: string | null;
  lugar: { nome: string; lat: number; lon: number; celula: string } | null;
  lavoura: { cultura: string; fase: string; irrigada: boolean; irrigouEm: string | null } | null;
  preferencias: { modo: Modo; horarios: number[]; pausado: boolean };
  ultimoEnvio: { quando: string; tipo: string; entregue: boolean } | null;
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

export interface Resumo {
  usuarios: { ativos: number; pendentes: number; bloqueados: number };
  lugares: number;
  enviosHoje: number;
  alertasSemana: Array<{ regra: string; n: number }>;
  enviosPorDia: Array<{ dia: string; tipo: string; n: number }>;
  mapa: Array<{ userId: string; nome: string; lat: number; lon: number; severidade: Severidade | null }>;
}

export interface Ponto {
  hora: string;
  temperatura: number | null;
  umidade: number | null;
  chuva: number | null;
  vento: number | null;
  rajada: number | null;
  vpd: number | null;
  probabilidade?: number | null;
}

export interface Tempo {
  lugar: { nome: string; celula: string };
  timezone: string;
  consultadoEm: string;
  ocorrido: Ponto[];
  previsao: Ponto[];
  comparacao: Array<{ hora: string; previstaTemperatura: number | null; ocorridaTemperatura: number | null; previstaChuva: number | null; ocorridaChuva: number | null }>;
  alertas: Array<{ quando: string; regras: string[]; severidade: Severidade | null }>;
}

export interface Balanco {
  kc: number;
  deficit: number;
  chuvaPrevista: number;
  limite: number;
  serie: Array<{ dia: string; et: number; chuva: number; deficit: number }>;
}

export interface Cultura {
  id: string;
  nome: string;
  fases: Record<string, { nome: string; kc: number }>;
}

/** Pedidos que mudam algo levam o cabeçalho do painel (o servidor recusa sem ele: proteção contra outros sites). */
export const cabecalhoDoPainel: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const comCabecalho = req.method === 'GET' ? req : req.clone({ setHeaders: { 'X-Requested-With': 'k7' } });
  return next(comCabecalho).pipe(
    catchError((erro: HttpErrorResponse) => {
      if (erro.status === 401 && !req.url.endsWith('/entrar')) void router.navigate(['/entrar']);
      return throwError(() => erro);
    }),
  );
};

/** Mensagem legível de um erro da API. */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof HttpErrorResponse) return (erro.error as { erro?: string } | null)?.erro ?? `Falha (${erro.status})`;
  return erro instanceof Error ? erro.message : String(erro);
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  /** Conta que entrou (ou null). */
  readonly eu = signal<Admin | null>(null);

  private get<T>(rota: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const limpos = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string>;
    return firstValueFrom(this.http.get<T>(`/api/admin${rota}`, { params: limpos }));
  }

  private post<T>(rota: string, corpo: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(`/api/admin${rota}`, corpo));
  }

  async entrar(email: string, senha: string): Promise<Admin> {
    const admin = await this.post<Admin>('/entrar', { email, senha });
    this.eu.set(admin);
    return admin;
  }

  async sair(): Promise<void> {
    await this.post('/sair');
    this.eu.set(null);
  }

  async carregarEu(): Promise<Admin | null> {
    try {
      this.eu.set(await this.get<Admin>('/eu'));
    } catch {
      this.eu.set(null);
    }
    return this.eu();
  }

  podeEditar(): boolean {
    return this.eu()?.papel === 'admin';
  }

  resumo = () => this.get<Resumo>('/resumo');
  usuarios = () => this.get<Usuario[]>('/usuarios');
  culturas = () => this.get<Cultura[]>('/culturas');
  envios = (filtro: { usuario?: string; tipo?: string; q?: string; de?: string; ate?: string } = {}) => this.get<Envio[]>('/envios', filtro);
  tempo = (userId: string, dias = 30) => this.get<Tempo>(`/usuarios/${userId}/tempo`, { dias });
  balanco = (userId: string) => this.get<Balanco>(`/usuarios/${userId}/balanco`);
  definirStatus = (userId: string, status: 'ativo' | 'bloqueado') => this.post(`/usuarios/${userId}`, { status });
  enviarTeste = (userId: string) => this.post<{ entregue: boolean; erro?: string }>(`/usuarios/${userId}/teste`);
  salvarLavoura = (userId: string, lavoura: { cultura: string; fase: string; irrigada: boolean }) => this.post(`/usuarios/${userId}/lavoura`, lavoura);
  salvarPreferencias = (userId: string, p: { modo?: Modo; horarios?: number[]; pausado?: boolean }) => this.post(`/usuarios/${userId}/preferencias`, p);
  convite = (dados: { nome?: string; dias?: number; usos?: number }) => this.post<{ link: string; expiraEm: string; qr: string }>('/convites', dados);
  administradores = () => this.get<Admin[]>('/administradores');
  criarAdministrador = (dados: { email: string; nome: string; senha: string; papel: 'admin' | 'leitura' }) => this.post<Admin>('/administradores', dados);
}

/** Data do SQLite ("2026-10-30 10:00:00", em UTC) para o DatePipe mostrar no fuso de quem vê. */
export function utc(data: string | null | undefined): string | null {
  return data ? `${data.replace(' ', 'T')}Z` : null;
}

/** Nomes legíveis das regras (ids de regras/clima.yaml). */
export const REGRAS: Record<string, string> = {
  geada: 'Geada',
  calor: 'Calor forte',
  chuva_forte: 'Chuva forte',
  vento_forte: 'Vento forte',
  doenca_fungica: 'Doença fúngica',
  ar_seco: 'Ar seco',
  colheita: 'Janela de colheita',
  plantio: 'Plantio',
  pulverizacao: 'Pulverização',
  irrigacao: 'Irrigação',
};

export const MODOS: Record<Modo, string> = {
  boletim: 'Boletim nos horários',
  hora: 'Boletim + alertas de hora em hora',
  alertas: 'Só alertas',
  pedir: 'Só quando pedir',
};

/** Exporta linhas como CSV (para o relatório da disciplina). */
export function baixarCsv(nome: string, linhas: Array<Record<string, unknown>>): void {
  if (!linhas.length) return;
  const colunas = Object.keys(linhas[0]!);
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' ') : String(v);
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = [colunas.join(';'), ...linhas.map((l) => colunas.map((c) => esc(l[c])).join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
