import type { Banco, Lugar, Severidade } from './Banco.js';
import { errorMessage } from './erros.js';
import type { FitaApi } from './k7.js';
import { mensagemAlerta, mensagemBoletim } from './Mensagens.js';
import { type OpenMeteo, horaLocal } from './OpenMeteo.js';
import { type Cultura, type Regra, type Resultado, avaliarRegras } from './Regras.js';

const PIOR: Record<Severidade, number> = { info: 0, atencao: 1, grave: 2 };

/** Erro que não melhora tentando de novo (a pessoa bloqueou o bot, apagou a conta, bot desligado): não reenvia. */
const DEFINITIVO = /blocked|deactivated|chat not found|user is deactivated|canal Telegram desligado/i;
const resolvido = (e: { entregue: boolean; erro?: string }) => e.entregue || DEFINITIVO.test(e.erro ?? '');

/**
 * Envio automático pelo Telegram (tarefa da fita). Para cada lugar cadastrado:
 * - nos horários do boletim (modos `boletim` e `hora`), manda o resumo do dia com as recomendações;
 * - fora deles, manda os alertas novos (ou que pioraram): no modo `boletim`, só os graves; em `hora` e `alertas`,
 *   os de atenção e os graves;
 * - entre 22h e 6h (hora do lugar), só alertas graves; `pedir` e pausados não recebem nada.
 * Cada aviso (regra + dia) vai uma vez só, e tudo o que sai fica registrado em `envios`.
 */
export class Notificador {
  constructor(
    private readonly k7: FitaApi,
    private readonly banco: Banco,
    private readonly meteo: OpenMeteo,
    private readonly regras: () => Regra[],
    private readonly culturas: () => Cultura[],
  ) {}

  async ciclo(agora = new Date()): Promise<{ boletins: number; alertas: number }> {
    const bloqueados = new Set(this.k7.telegram.acessos.listar().filter((a) => a.status === 'bloqueado').map((a) => String(a.userId)));
    let boletins = 0;
    let alertas = 0;
    for (const lugar of this.banco.lugares()) {
      if (bloqueados.has(lugar.userId)) continue;
      const prefs = this.banco.preferencias(lugar.userId);
      if (prefs.pausado || prefs.modo === 'pedir') continue;
      try {
        const r = await this.avaliarLugar(lugar, prefs.modo, prefs.horarios, agora);
        boletins += r.boletim ? 1 : 0;
        alertas += r.alertas;
      } catch (error) {
        this.k7.log.aviso(`Notificação de ${lugar.userId}: ${errorMessage(error)}`);
      }
    }
    return { boletins, alertas };
  }

  /** Boletim agora, fora de hora (botão "enviar teste" do painel). */
  async boletimAgora(userId: string, tipo: 'boletim' | 'teste' = 'teste'): Promise<{ entregue: boolean; erro?: string }> {
    const lugar = this.banco.lugar(userId);
    if (!lugar) return { entregue: false, erro: 'essa pessoa ainda não mandou a localização' };
    const p = await this.meteo.previsao(lugar.celula);
    const lavoura = this.banco.lavoura(userId);
    const resultados = avaliarRegras(this.regras(), p, lavoura, this.culturas());
    return this.enviar(userId, tipo, resultados, mensagemBoletim(p, lugar, lavoura, this.culturas(), resultados));
  }

  private async avaliarLugar(lugar: Lugar, modo: string, horarios: number[], agora: Date): Promise<{ boletim: boolean; alertas: number }> {
    const p = await this.meteo.previsao(lugar.celula);
    const local = horaLocal(agora, p.utcOffsetSeconds);
    const hoje = local.slice(0, 10);
    const hora = Number(local.slice(11, 13));
    const lavoura = this.banco.lavoura(lugar.userId);
    const resultados = avaliarRegras(this.regras(), p, lavoura, this.culturas(), agora);
    const novos = (r: Resultado) => !this.banco.jaAvisado(lugar.userId, `${r.regra}:${r.dia}`, r.severidade);

    if ((modo === 'boletim' || modo === 'hora') && horarios.includes(hora)) {
      const chave = `boletim:${hoje}:${hora}`;
      if (this.banco.jaAvisado(lugar.userId, chave, 'info')) return { boletim: false, alertas: 0 };
      this.banco.marcarAvisado(lugar.userId, chave, 'info');
      const envio = await this.enviar(lugar.userId, 'boletim', resultados, mensagemBoletim(p, lugar, lavoura, this.culturas(), resultados, agora));
      // O que foi no boletim não volta logo depois como alerta.
      if (resolvido(envio)) for (const r of resultados.filter((x) => x.alerta)) this.banco.marcarAvisado(lugar.userId, `${r.regra}:${r.dia}`, r.severidade);
      return { boletim: envio.entregue, alertas: 0 };
    }

    const silencio = hora >= 22 || hora < 6;
    const enviar = resultados
      .filter((r) => r.alerta && novos(r))
      .filter((r) => (modo === 'boletim' ? r.severidade === 'grave' : true))
      .filter((r) => !silencio || r.severidade === 'grave');
    if (!enviar.length) return { boletim: false, alertas: 0 };
    const envio = await this.enviar(lugar.userId, 'alerta', enviar, mensagemAlerta(lugar, enviar, p));
    // Falha passageira (limite do Telegram, rede): tenta de novo no próximo ciclo. Definitiva: não insiste.
    if (resolvido(envio)) for (const r of enviar) this.banco.marcarAvisado(lugar.userId, `${r.regra}:${r.dia}`, r.severidade);
    return { boletim: false, alertas: envio.entregue ? enviar.length : 0 };
  }

  private async enviar(userId: string, tipo: 'boletim' | 'alerta' | 'teste', resultados: Resultado[], texto: string) {
    const envio = await this.k7.telegram.notificar(userId, texto);
    const pior = resultados.reduce<Severidade | null>((max, r) => (!max || PIOR[r.severidade] > PIOR[max] ? r.severidade : max), null);
    this.banco.registrarEnvio({ userId, tipo, regras: resultados.map((r) => r.regra), severidade: pior, texto, entregue: envio.entregue, erro: envio.erro ?? null });
    return envio;
  }
}
