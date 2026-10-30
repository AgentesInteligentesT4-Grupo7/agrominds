import { UserFacingError } from './erros.js';
import type { FitaToolCtx, TelegramResposta } from './k7.js';
import { balancoHidrico } from './Regras.js';
import { somarDias } from './Plantas.js';
import { type Contexto, calendarioDe, hojeLocal, lugarOuErro, minhasPlantas, plantasDe, previsaoDoPeriodo, tempoAgora } from './Servicos.js';
import { PERIODOS, ehPeriodo } from './Visual.js';

/** A imagem (layout) vai junto da resposta; o agente recebe o texto com os números. */
function anexar(ctx: FitaToolCtx, mensagem: string | TelegramResposta): void {
  if (typeof mensagem !== 'string' && mensagem.imagem) ctx.anexarImagem(mensagem.imagem);
}

const IMAGEM = '\n\n(A imagem com estes dados já vai junto da sua resposta: responda em poucas frases, sem repetir a tabela.)';

/**
 * Ferramentas do agente: os números vêm daqui (Open-Meteo, regras e ZARC), nunca do modelo. A localização da pessoa
 * não vai para o modelo: ele recebe o nome do lugar e os dados.
 */
export function registrarFerramentas(c: Contexto): void {
  const { k7, banco } = c;
  const idsPlantas = () => c.plantas().map((p) => p.id);

  k7.ferramenta({
    name: 'clima_lavoura',
    description:
      'Tempo agora e nos próximos dias onde a pessoa planta, com os alertas e recomendações das regras para as plantas dela ' +
      '(geada, calor, chuva forte, vento, doença, pulverização, irrigação, colheita). Use para perguntas gerais sobre o tempo ou o que fazer hoje.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, ctx) {
      lugarOuErro(c, ctx.userId);
      const s = await tempoAgora(c, ctx.userId!, 'clima');
      anexar(ctx, s.mensagem);
      return s.texto + (typeof s.mensagem === 'string' ? '' : IMAGEM);
    },
  });

  k7.ferramenta({
    name: 'previsao_periodo',
    description: 'Previsão para um período: hoje, amanhã, fim de semana, 3, 7 ou 14 dias (mínima, máxima, chuva, vento). Use para "vai chover no fim de semana?", "como fica a semana?".',
    parameters: {
      type: 'object',
      properties: { periodo: { type: 'string', enum: PERIODOS.map(([id]) => id), description: 'hoje | amanha | fds (fim de semana) | 3 | 7 | 14 (dias)' } },
      required: ['periodo'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      lugarOuErro(c, ctx.userId);
      const periodo = ehPeriodo(args.periodo) ? args.periodo : '7';
      const s = await previsaoDoPeriodo(c, ctx.userId!, periodo);
      anexar(ctx, s.mensagem);
      return s.texto + (typeof s.mensagem === 'string' ? '' : IMAGEM);
    },
  });

  k7.ferramenta({
    name: 'epoca_de_plantio',
    description:
      'Época de plantar no município da pessoa, pelo zoneamento oficial (ZARC, MAPA/Embrapa). `sugerir`: a lista do que dá para plantar ' +
      'agora (em ordem alfabética; opcionalmente só da horta ou só da lavoura). `plantas`: plantas que a pessoa perguntou; com `sugerir`, ' +
      'entram a mais na tabela, mesmo fora de época ou sem dado. Use para "quando planto feijão?", "o que planto agora na horta?" e, ' +
      'depois da lista, "e o tomate?" (sugerir: true, plantas: ["tomate"]).',
    parameters: {
      type: 'object',
      properties: {
        sugerir: { type: 'boolean', description: 'true: a lista do que plantar agora (padrão quando não há `plantas`)' },
        plantas: { type: 'array', items: { type: 'string' }, description: `Plantas que a pessoa citou, pelo nome ou id (catálogo: ${idsPlantas().join(', ')}; outras entram como "sem dado")` },
        grupo: { type: 'string', enum: ['horta', 'lavoura'], description: 'Só horta/quintal/pomar ou só lavoura' },
      },
      additionalProperties: false,
    },
    async run(args, ctx) {
      lugarOuErro(c, ctx.userId);
      const plantas = Array.isArray(args.plantas) ? args.plantas.map(String).filter((p) => p.trim()) : [];
      const grupo = args.grupo === 'horta' || args.grupo === 'lavoura' ? args.grupo : undefined;
      const s =
        args.sugerir === true || !plantas.length
          ? await calendarioDe(c, ctx.userId!, { todas: true, sugerir: true, ...(grupo ? { grupo } : {}), incluir: plantas })
          : await calendarioDe(c, ctx.userId!, { plantas: [], incluir: plantas });
      anexar(ctx, s.mensagem);
      return s.texto + (typeof s.mensagem === 'string' ? '' : IMAGEM);
    },
  });

  k7.ferramenta({
    name: 'minhas_plantas',
    description: 'O que a pessoa planta: fase de cada planta, colheita estimada, irrigação e a época de plantio no município.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, ctx) {
      lugarOuErro(c, ctx.userId);
      const s = await minhasPlantas(c, ctx.userId!);
      anexar(ctx, s.mensagem);
      return s.texto + (typeof s.mensagem === 'string' ? '' : IMAGEM);
    },
  });

  k7.ferramenta({
    name: 'balanco_agua',
    description: 'Conta de água das plantas irrigadas (ou de uma planta): quanto perderam (evapotranspiração × Kc da fase) menos a chuva, nos últimos dias, e a chuva prevista. Use em perguntas sobre irrigar.',
    parameters: { type: 'object', properties: { planta: { type: 'string', enum: idsPlantas(), description: 'Planta (padrão: as irrigadas, ou todas)' } }, additionalProperties: false },
    async run(args, ctx) {
      const lugar = lugarOuErro(c, ctx.userId);
      const todas = plantasDe(c, lugar.userId);
      if (!todas.length) throw new UserFacingError('A pessoa ainda não disse o que planta: peça para usar /plantas.');
      const escolhidas = typeof args.planta === 'string' ? todas.filter((l) => l.planta === args.planta) : todas.some((l) => l.irrigada) ? todas.filter((l) => l.irrigada) : todas;
      const p = await c.meteo.previsao(lugar.celula);
      return [
        ...escolhidas.flatMap((l) => {
          const cultura = c.culturas().find((x) => x.id === l.cultura);
          const kc = cultura?.fases[l.fase]?.kc ?? 1;
          const b = balancoHidrico(p, kc, 7, 2, l.irrigouEm);
          const nome = c.plantas().find((x) => x.id === l.planta)?.nome ?? l.planta;
          return [`${nome}: fase ${cultura?.fases[l.fase]?.nome ?? l.fase} (Kc ${kc}), ${l.irrigada ? 'irrigada' : 'sem irrigação'} · déficit ${b.deficit} mm em 7 dias · chuva prevista em 2 dias ${b.chuvaPrevista} mm`];
        }),
        'Valores de referência (regras em revisão por agrônomo); não substituem a avaliação no local.',
      ].join('\n');
    },
  });

  k7.ferramenta({
    name: 'definir_planta',
    description:
      'Registra (ou remove) uma planta da pessoa quando ela contar na conversa: "plantei milho semana passada", "tenho alface e couve na horta", ' +
      '"a soja está florindo", "não planto mais tomate". Use a data de plantio quando ela disser (o bot calcula a fase).',
    parameters: {
      type: 'object',
      properties: {
        planta: { type: 'string', enum: idsPlantas(), description: 'Planta do catálogo' },
        plantio: { type: 'string', description: 'Data de plantio AAAA-MM-DD (aproximada vale); "hoje" = hoje' },
        fase: { type: 'string', enum: [...new Set(c.culturas().flatMap((x) => Object.keys(x.fases)))], description: 'Fase, quando ela disser (sem data de plantio)' },
        irrigada: { type: 'boolean', description: 'É irrigada?' },
        remover: { type: 'boolean', description: 'true: a pessoa não planta mais isso' },
      },
      required: ['planta'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      if (!ctx.userId) throw new UserFacingError('Só dá para registrar plantas numa conversa identificada (Telegram).');
      const planta = c.plantas().find((p) => p.id === args.planta);
      if (!planta) throw new UserFacingError('Não conheço essa planta.');
      if (args.remover === true) {
        banco.removerLavoura(ctx.userId, planta.id);
        return `ok: ${planta.nome} removida.`;
      }
      const plantio = args.plantio === 'hoje' ? hojeLocal() : typeof args.plantio === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.plantio) ? args.plantio : undefined;
      if (plantio && plantio > somarDias(hojeLocal(), 120)) throw new UserFacingError('Essa data de plantio está longe demais no futuro.');
      const l = banco.salvarLavoura(ctx.userId, planta.id, {
        cultura: planta.cultura,
        ...(plantio ? { plantio } : {}),
        ...(typeof args.fase === 'string' ? { fase: args.fase } : {}),
        ...(typeof args.irrigada === 'boolean' ? { irrigada: args.irrigada } : {}),
        pendente: false,
      });
      return `ok: ${planta.nome} registrada${l.plantio ? `, plantio ${l.plantio}` : ''}${l.irrigada ? ', irrigada' : ''}.`;
    },
  });
}
