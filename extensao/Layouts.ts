import fs from 'node:fs';
import path from 'node:path';
import type { FitaApi, TelegramResposta } from './k7.js';

export type NomeLayout = 'tempo' | 'previsao' | 'plantas' | 'calendario' | 'alerta';

/**
 * Layouts da fita (pasta layouts/: HTML + CSS que o grupo edita e abre no navegador para ver com os dados de
 * exemplo). Para mandar, a fita junta o HTML com o estilo, os scripts e os dados numa página só e tira o "print"
 * (k7.util.htmlParaPng). Sem navegador, ou com AGRO_IMAGEM=off, vai só o texto.
 */
export class Layouts {
  constructor(
    private readonly k7: FitaApi,
    private readonly dir = path.join(k7.fita.dir, 'layouts'),
  ) {}

  /** Página única: estilo e scripts embutidos e `window.DADOS` antes do desenho. */
  html(nome: NomeLayout, dados: unknown): string {
    const ler = (arquivo: string) => fs.readFileSync(path.join(this.dir, arquivo), 'utf8');
    // `<` vira <: nenhum texto dos dados (nome de lugar, mensagem) fecha o <script>.
    const json = JSON.stringify(dados).replace(/</g, '\\u003c');
    return ler(`${nome}.html`)
      .replace(/<link rel="stylesheet" href="([\w-]+\.css)">/g, (_m, arquivo: string) => `<style>${ler(arquivo)}</style>`)
      .replace(/<script src="([\w-]+\.js)"><\/script>/, (_m, arquivo: string) => `<script>window.DADOS = ${json};</script>\n<script>${ler(arquivo)}</script>`);
  }

  async imagem(nome: NomeLayout, dados: unknown): Promise<Buffer> {
    return this.k7.util.htmlParaPng(this.html(nome, dados), { largura: 720 });
  }

  /**
   * Mensagem com o print do layout e uma legenda curta (o texto completo fica para quando não há imagem).
   * Falhou a imagem (sem navegador, layout com erro): manda o texto completo e avisa no log.
   */
  async mensagem(nome: NomeLayout, dados: unknown, legenda: string, textoCompleto: string): Promise<string | TelegramResposta> {
    if (this.k7.fita.env.AGRO_IMAGEM === 'off') return textoCompleto;
    try {
      return { texto: legenda, imagem: await this.imagem(nome, dados) };
    } catch (error) {
      this.k7.log.aviso(`Imagem "${nome}" não gerada (${error instanceof Error ? error.message : String(error)}); vai só o texto`);
      return textoCompleto;
    }
  }
}
