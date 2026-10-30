import { UserFacingError } from './erros.js';
import { mensagemClima, proximosDias } from './Mensagens.js';
import { avaliarRegras, balancoHidrico } from './Regras.js';
import type { Contexto } from './telegram.js';

const SEM_LUGAR = 'Essa pessoa ainda não mandou a localização da roça. Peça para ela tocar em /start no Telegram e enviar a localização.';

/**
 * Ferramentas do agente: os números vêm daqui (Open-Meteo + regras da fita), nunca do modelo. A localização da
 * pessoa não vai para o modelo: ele recebe o nome do lugar e os dados do tempo.
 */
export function registrarFerramentas(c: Contexto): void {
  const { k7, banco } = c;
  const lugarDe = (userId?: string) => {
    const lugar = userId ? banco.lugar(userId) : undefined;
    if (!lugar) throw new UserFacingError(SEM_LUGAR);
    return lugar;
  };

  k7.ferramenta({
    name: 'clima_lavoura',
    description:
      'Tempo agora e nos próximos dias no lugar da lavoura de quem está conversando, com os alertas e recomendações das regras da fita ' +
      '(geada, calor, chuva forte, vento, doença, pulverização, irrigação, colheita). Use para qualquer pergunta sobre o tempo ou o que fazer na lavoura.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, ctx) {
      const lugar = lugarDe(ctx.userId);
      const p = await c.meteo.previsao(lugar.celula);
      const lavoura = banco.lavoura(lugar.userId);
      return mensagemClima(p, lugar, lavoura, c.culturas(), avaliarRegras(c.regras(), p, lavoura, c.culturas()));
    },
  });

  k7.ferramenta({
    name: 'previsao_dias',
    description: 'Previsão dia a dia (mínima, máxima, chance e quantidade de chuva) no lugar da lavoura, para até 7 dias.',
    parameters: { type: 'object', properties: { dias: { type: 'integer', description: 'Quantos dias (1 a 7). Padrão 7.' } }, additionalProperties: false },
    async run(args, ctx) {
      const lugar = lugarDe(ctx.userId);
      const p = await c.meteo.previsao(lugar.celula);
      const dias = Math.max(1, Math.min(7, Number(args.dias) || 7));
      return [`Previsão para ${lugar.nome} (Open-Meteo):`, ...proximosDias(p, dias)].join('\n');
    },
  });

  k7.ferramenta({
    name: 'balanco_agua',
    description: 'Conta de água da lavoura: quanto ela perdeu (evapotranspiração × Kc da fase) menos a chuva, nos últimos dias, e a chuva prevista. Use em perguntas sobre irrigar.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, ctx) {
      const lugar = lugarDe(ctx.userId);
      const lavoura = banco.lavoura(lugar.userId);
      if (!lavoura) throw new UserFacingError('A pessoa ainda não disse o que planta: peça para usar /lavoura.');
      const cultura = c.culturas().find((x) => x.id === lavoura.cultura);
      const kc = cultura?.fases[lavoura.fase]?.kc ?? 1;
      const p = await c.meteo.previsao(lugar.celula);
      const b = balancoHidrico(p, kc, 7, 2, lavoura.irrigouEm);
      return [
        `Lavoura: ${cultura?.nome ?? lavoura.cultura}, fase ${cultura?.fases[lavoura.fase]?.nome ?? lavoura.fase} (Kc ${kc}), ${lavoura.irrigada ? 'irrigada' : 'sem irrigação'}.`,
        `Déficit acumulado: ${b.deficit} mm; chuva prevista nos próximos 2 dias: ${b.chuvaPrevista} mm.`,
        ...b.serie.map((d) => `${d.dia}: perdeu ${d.et} mm, choveu ${d.chuva} mm, déficit ${d.deficit} mm`),
        'Valores de referência (regras em revisão por agrônomo); não substituem a avaliação no campo.',
      ].join('\n');
    },
  });

  k7.ferramenta({
    name: 'definir_lavoura',
    description: 'Registra o que a pessoa planta, a fase e se é irrigada, quando ela contar na conversa (ex.: "plantei milho semana passada").',
    parameters: {
      type: 'object',
      properties: {
        cultura: { type: 'string', enum: c.culturas().map((x) => x.id), description: 'Cultura' },
        fase: { type: 'string', enum: [...new Set(c.culturas().flatMap((x) => Object.keys(x.fases)))], description: 'Fase da lavoura' },
        irrigada: { type: 'boolean', description: 'A lavoura é irrigada?' },
      },
      additionalProperties: false,
    },
    async run(args, ctx) {
      if (!ctx.userId) throw new UserFacingError('Só dá para registrar a lavoura numa conversa identificada (Telegram).');
      const lavoura = banco.salvarLavoura(ctx.userId, {
        ...(typeof args.cultura === 'string' ? { cultura: args.cultura } : {}),
        ...(typeof args.fase === 'string' ? { fase: args.fase } : {}),
        ...(typeof args.irrigada === 'boolean' ? { irrigada: args.irrigada } : {}),
      });
      return `ok: lavoura registrada (${lavoura.cultura}, fase ${lavoura.fase}, ${lavoura.irrigada ? 'irrigada' : 'sem irrigação'}).`;
    },
  });
}
