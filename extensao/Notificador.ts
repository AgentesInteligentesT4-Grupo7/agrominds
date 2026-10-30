import type { Lugar, Severidade } from './Banco.js';
import { errorMessage } from './erros.js';
import type { TelegramResposta } from './k7.js';
import { legenda, mensagemAlerta } from './Mensagens.js';
import { horaLocal } from './OpenMeteo.js';
import { type Resultado, chaveDe } from './Regras.js';
import { type Base, avaliar, calendarioDe, hojeLocal, plantasDe, tempoAgora } from './Servicos.js';
import { dadosAlerta } from './Visual.js';

const PIOR: Record<Severidade, number> = { info: 0, atencao: 1, grave: 2 };

/** Quem é do Telegram (id numérico); o chat web usa "web" e "web-…", que não recebem notificação. */
const TELEGRAM = /^\d+$/;

/** Erro que não melhora tentando de novo (a pessoa bloqueou o bot, apagou a conta, bot desligado): não reenvia. */
const DEFINITIVO = /blocked|deactivated|chat not found|user is deactivated|canal Telegram desligado/i;
const resolvido = (e: { entregue: boolean; erro?: string }) => e.entregue || DEFINITIVO.test(e.erro ?? '');

/**
 * Envio automático pelo Telegram (tarefa da fita). Para cada lugar de cada pessoa do Telegram (quem só usa o chat
 * web não recebe nada sozinho):
 * - nos horários do boletim (modos `boletim` e `hora`), manda o resumo do dia com as recomendações;
 * - fora deles, manda os alertas novos (ou que pioraram): no modo `boletim`, só os graves; em `hora` e `alertas`,
 *   os de atenção e os graves;
 * - entre 22h e 6h (hora do lugar), só alertas graves; `pedir` e pausados não recebem nada.
 * Cada aviso (lugar + regra + plantas + dia) vai uma vez só, e tudo o que sai fica registrado em `envios`. Boletim e alerta
 * vão como imagem (layouts/tempo.html e layouts/alerta.html), com o texto de reserva.
 */
export class Notificador {
  constructor(private readonly c: Base) {}

  async ciclo(agora = new Date()): Promise<{ boletins: number; alertas: number }> {
    const bloqueados = new Set(this.c.k7.telegram.acessos.listar().filter((a) => a.status === 'bloqueado').map((a) => String(a.userId)));
    let boletins = 0;
    let alertas = 0;
    for (const lugar of this.c.banco.todosLugares()) {
      if (!TELEGRAM.test(lugar.userId) || bloqueados.has(lugar.userId)) continue;
      const prefs = this.c.banco.preferencias(lugar.userId);
      if (prefs.pausado || prefs.modo === 'pedir') continue;
      try {
        const r = await this.avaliarLugar(lugar, prefs.modo, prefs.horarios, agora);
        boletins += r.boletim ? 1 : 0;
        alertas += r.alertas;
      } catch (error) {
        this.c.k7.log.aviso(`Notificação de ${lugar.userId}: ${errorMessage(error)}`);
      }
    }
    return { boletins, alertas };
  }

  /** Boletim agora, fora de hora (botão "enviar teste" do painel), do lugar atual da pessoa. */
  async boletimAgora(userId: string, tipo: 'boletim' | 'teste' = 'teste'): Promise<{ entregue: boolean; erro?: string }> {
    if (!this.c.banco.lugar(userId)) return { entregue: false, erro: 'essa pessoa ainda não mandou a localização' };
    if (!TELEGRAM.test(userId)) return { entregue: false, erro: 'essa pessoa usa só o chat web (sem Telegram)' };
    const s = await tempoAgora(this.c, userId, 'boletim');
    return this.enviar(userId, tipo, s.resultados, s.texto, s.mensagem);
  }

  private async avaliarLugar(lugar: Lugar, modo: string, horarios: number[], agora: Date): Promise<{ boletim: boolean; alertas: number }> {
    const p = await this.c.meteo.previsao(lugar.celula);
    const local = horaLocal(agora, p.utcOffsetSeconds);
    const hoje = local.slice(0, 10);
    const hora = Number(local.slice(11, 13));
    // As chaves levam o lugar: a mesma geada em dois lugares são dois avisos.
    const chave = (r: Resultado) => `L${lugar.id}:${chaveDe(r)}`;
    const novos = (r: Resultado) => !this.c.banco.jaAvisado(lugar.userId, chave(r), r.severidade);

    if ((modo === 'boletim' || modo === 'hora') && horarios.includes(hora)) {
      const doBoletim = `boletim:L${lugar.id}:${hoje}:${hora}`;
      if (this.c.banco.jaAvisado(lugar.userId, doBoletim, 'info')) return { boletim: false, alertas: 0 };
      this.c.banco.marcarAvisado(lugar.userId, doBoletim, 'info');
      const s = await tempoAgora(this.c, lugar.userId, 'boletim', agora, lugar.id);
      const envio = await this.enviar(lugar.userId, 'boletim', s.resultados, s.texto, s.mensagem);
      // O que foi no boletim não volta logo depois como alerta.
      if (resolvido(envio)) for (const r of s.resultados.filter((x) => x.alerta)) this.c.banco.marcarAvisado(lugar.userId, chave(r), r.severidade);
      if (envio.entregue) await this.sugestaoDoMes(lugar.userId, lugar.id, hoje);
      return { boletim: envio.entregue, alertas: 0 };
    }

    const resultados = avaliar(this.c, p, plantasDe(this.c, lugar.userId, hojeLocal(agora), lugar.id), agora);
    const silencio = hora >= 22 || hora < 6;
    const enviar = resultados
      .filter((r) => r.alerta && novos(r))
      .filter((r) => (modo === 'boletim' ? r.severidade === 'grave' : true))
      .filter((r) => !silencio || r.severidade === 'grave');
    if (!enviar.length) return { boletim: false, alertas: 0 };
    const texto = mensagemAlerta(lugar, enviar, p);
    const mensagem = await this.c.layouts.mensagem('alerta', dadosAlerta(p, lugar, enviar, agora), legenda(`⚠️ Aviso para ${lugar.nome}`, enviar), texto);
    const envio = await this.enviar(lugar.userId, 'alerta', enviar, texto, mensagem);
    // Falha passageira (limite do Telegram, rede): tenta de novo no próximo ciclo. Definitiva: não insiste.
    if (resolvido(envio)) for (const r of enviar) this.c.banco.marcarAvisado(lugar.userId, chave(r), r.severidade);
    return { boletim: false, alertas: envio.entregue ? enviar.length : 0 };
  }

  /** Uma vez por mês e por lugar, depois do primeiro boletim: o que dá para plantar agora no município (precisa do ZARC). */
  private async sugestaoDoMes(userId: string, lugarId: number, hoje: string): Promise<void> {
    const chave = `sugestao:L${lugarId}:${hoje.slice(0, 7)}`;
    if (this.c.zarc.vazio() || this.c.banco.jaAvisado(userId, chave, 'info')) return;
    this.c.banco.marcarAvisado(userId, chave, 'info');
    try {
      const s = await calendarioDe(this.c, userId, { todas: true, sugerir: true, lugarId });
      await this.enviar(userId, 'boletim', [], s.texto, s.mensagem);
    } catch (error) {
      this.c.k7.log.aviso(`Sugestão do mês para ${userId}: ${errorMessage(error)}`);
    }
  }

  /** Manda e registra; o texto registrado é o completo (a imagem leva só a legenda). */
  private async enviar(userId: string, tipo: 'boletim' | 'alerta' | 'teste', resultados: Resultado[], texto: string, mensagem: string | TelegramResposta) {
    const envio = await this.c.k7.telegram.notificar(userId, mensagem);
    const pior = resultados.reduce<Severidade | null>((max, r) => (!max || PIOR[r.severidade] > PIOR[max] ? r.severidade : max), null);
    this.c.banco.registrarEnvio({ userId, tipo, regras: resultados.map((r) => r.regra), severidade: pior, texto, entregue: envio.entregue, erro: envio.erro ?? null });
    return envio;
  }
}
