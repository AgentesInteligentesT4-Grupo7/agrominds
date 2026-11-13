import { UserFacingError } from './erros.js';
import type { ModoEnvio } from './Banco.js';
import { TIPOS, diaDe, ehTipo, linhaDaAnotacao, textoCaderno } from './Caderno.js';
import { horasDePulverizar, textoPulverizacao } from './Pulverizacao.js';
import type { FitaTool, FitaToolCtx, TelegramResposta } from './k7.js';
import { textoChuvaPorHora } from './Chuva.js';
import { textoRadar } from './Radar.js';
import { aguaDaSemana, balancoHidrico } from './Regras.js';
import { somarDias } from './Plantas.js';
import { type Contexto, acharLugar, calendarioDe, hojeLocal, lugarOuErro, minhasPlantas, peloTelegram, plantasDe, previsaoDoPeriodo, tempoAgora } from './Servicos.js';
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
  const LUGAR = { type: 'string', description: 'Nome do lugar, quando a pessoa citar ("sítio", "fazenda Boa Vista", "Rio Verde"); sem ele, o lugar em uso' };

  /** O lugar que a pessoa citou (pelo nome) ou o em uso; nome que não bate com nenhum lugar vira erro com a lista. */
  const lugarDe = (args: Record<string, unknown>, userId: string | undefined): number => {
    const atual = lugarOuErro(c, userId);
    if (typeof args.lugar !== 'string' || !args.lugar.trim()) return atual.id;
    const achado = acharLugar(c, userId!, args.lugar);
    if (achado) return achado.id;
    const nomes = banco.lugaresDe(userId!).map((l) => l.nome).join('; ');
    throw new UserFacingError(`Não achei o lugar "${args.lugar}". Os lugares cadastrados são: ${nomes}.`);
  };

  k7.ferramenta({
    name: 'clima_lavoura',
    description:
      'Tempo agora e nos próximos dias onde a pessoa planta, com os alertas e recomendações das regras para as plantas dela ' +
      '(geada, calor, chuva forte, vento, doença, pulverização, irrigação, colheita). Use para perguntas gerais sobre o tempo ou o que fazer hoje.',
    parameters: { type: 'object', properties: { lugar: LUGAR }, additionalProperties: false },
    async run(args, ctx) {
      const s = await tempoAgora(c, ctx.userId!, 'clima', new Date(), lugarDe(args, ctx.userId));
      anexar(ctx, s.mensagem);
      return s.texto + (typeof s.mensagem === 'string' ? '' : IMAGEM);
    },
  });

  k7.ferramenta({
    name: 'previsao_periodo',
    description: 'Previsão para um período: hoje, amanhã, fim de semana, 3, 7 ou 14 dias (mínima, máxima, chuva, vento). Use para "vai chover no fim de semana?", "como fica a semana?".',
    parameters: {
      type: 'object',
      properties: { periodo: { type: 'string', enum: PERIODOS.map(([id]) => id), description: 'hoje | amanha | fds (fim de semana) | 3 | 7 | 14 (dias)' }, lugar: LUGAR },
      required: ['periodo'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const lugarId = lugarDe(args, ctx.userId);
      const periodo = ehPeriodo(args.periodo) ? args.periodo : '7';
      const s = await previsaoDoPeriodo(c, ctx.userId!, periodo, new Date(), lugarId);
      anexar(ctx, s.mensagem);
      return s.texto + (typeof s.mensagem === 'string' ? '' : IMAGEM);
    },
  });

  k7.ferramenta({
    name: 'chuva_por_hora',
    description:
      'A que horas deve chover (previsão hora a hora, até 7 dias): janelas como "hoje das 15h às 18h", com chance, milímetros e a hora mais forte. ' +
      'Use para "que horas vai chover?", "vai chover hoje à tarde?", "dá para pulverizar de manhã?" e, com horas: 168, "que horas chove nesta semana?".',
    parameters: {
      type: 'object',
      properties: { horas: { type: 'integer', description: 'Quantas horas à frente, de 6 a 168 (padrão 48; a semana = 168)' }, lugar: LUGAR },
      additionalProperties: false,
    },
    async run(args, ctx) {
      const lugar = lugarOuErro(c, ctx.userId, lugarDe(args, ctx.userId));
      const horas = typeof args.horas === 'number' ? Math.min(168, Math.max(6, Math.round(args.horas))) : 48;
      return textoChuvaPorHora(await c.meteo.previsao(lugar.celula), lugar.nome, new Date(), horas);
    },
  });

  if (c.radar) {
    const radar = c.radar;
    k7.ferramenta({
      name: 'radar_chuva',
      description:
        'Chuva AGORA pelo radar meteorológico (imagem de poucos minutos atrás): se está chovendo no lugar, a que distância e em que direção está ' +
        'a chuva mais perto, para onde ela anda e, se vier para o lugar, a que horas chega (até 3 h). Use para "está chovendo aí?", ' +
        '"a chuva está vindo?", "chove na próxima hora?", "dá tempo de colher antes da chuva?". Para mais de 3 h ou outros dias, use chuva_por_hora.',
      parameters: { type: 'object', properties: { lugar: LUGAR }, additionalProperties: false },
      async run(args, ctx) {
        const lugar = lugarOuErro(c, ctx.userId, lugarDe(args, ctx.userId));
        return textoRadar(await radar.doLugar(lugar.lat, lugar.lon), lugar.nome, new Date());
      },
    });
  }

  k7.ferramenta({
    name: 'epoca_de_plantio',
    description:
      'Época de plantar no município da pessoa, pelo zoneamento oficial (ZARC, MAPA/Embrapa). `sugerir`: a lista do que dá para plantar ' +
      'agora (em ordem alfabética; opcionalmente só da horta ou só da lavoura). `plantas`: plantas que a pessoa perguntou; com `sugerir`, ' +
      'entram a mais na tabela, mesmo fora de época ou sem dado; sem `sugerir`, a tabela mostra só essas ("me mostra só uva e café"). ' +
      'A tabela traz também quando colhe (plantio + tempo médio) e quanto tempo leva. Use para "quando planto feijão?", "o que planto agora na horta?" e, ' +
      'depois da lista, "e o tomate?" (sugerir: true, plantas: ["tomate"]).',
    parameters: {
      type: 'object',
      properties: {
        sugerir: { type: 'boolean', description: 'true: a lista do que plantar agora (padrão quando não há `plantas`)' },
        plantas: { type: 'array', items: { type: 'string' }, description: `Plantas que a pessoa citou, pelo nome ou id (catálogo: ${idsPlantas().join(', ')}; outras entram como "sem dado")` },
        grupo: { type: 'string', enum: ['horta', 'lavoura'], description: 'Só horta/quintal/pomar ou só lavoura' },
        lugar: LUGAR,
      },
      additionalProperties: false,
    },
    async run(args, ctx) {
      const lugarId = lugarDe(args, ctx.userId);
      const plantas = Array.isArray(args.plantas) ? args.plantas.map(String).filter((p) => p.trim()) : [];
      const grupo = args.grupo === 'horta' || args.grupo === 'lavoura' ? args.grupo : undefined;
      const s =
        args.sugerir === true || !plantas.length
          ? await calendarioDe(c, ctx.userId!, { todas: true, sugerir: true, ...(grupo ? { grupo } : {}), incluir: plantas, lugarId })
          : await calendarioDe(c, ctx.userId!, { plantas: [], incluir: plantas, lugarId });
      anexar(ctx, s.mensagem);
      return s.texto + (typeof s.mensagem === 'string' ? '' : IMAGEM);
    },
  });

  k7.ferramenta({
    name: 'minhas_plantas',
    description: 'O que a pessoa planta num lugar: fase de cada planta, colheita estimada, irrigação e a época de plantio no município.',
    parameters: { type: 'object', properties: { lugar: LUGAR }, additionalProperties: false },
    async run(args, ctx) {
      const s = await minhasPlantas(c, ctx.userId!, new Date(), lugarDe(args, ctx.userId));
      anexar(ctx, s.mensagem);
      return s.texto + (typeof s.mensagem === 'string' ? '' : IMAGEM);
    },
  });

  k7.ferramenta({
    name: 'balanco_agua',
    description: 'Conta de água das plantas irrigadas (ou de uma planta): quanto perderam (evapotranspiração × Kc da fase) menos a chuva, nos últimos dias, e a chuva prevista. Use em perguntas sobre irrigar.',
    parameters: { type: 'object', properties: { planta: { type: 'string', enum: idsPlantas(), description: 'Planta (padrão: as irrigadas, ou todas)' }, lugar: LUGAR }, additionalProperties: false },
    async run(args, ctx) {
      const lugar = lugarOuErro(c, ctx.userId, lugarDe(args, ctx.userId));
      const todas = plantasDe(c, lugar.userId, hojeLocal(), lugar.id);
      if (!todas.length) throw new UserFacingError('A pessoa ainda não disse o que planta: peça para usar /plantas.');
      const escolhidas = typeof args.planta === 'string' ? todas.filter((l) => l.planta === args.planta) : todas.some((l) => l.irrigada) ? todas.filter((l) => l.irrigada) : todas;
      const p = await c.meteo.previsao(lugar.celula);
      const medida = c.banco.chuvaMedida(lugar.id);
      const dias = Object.keys(medida).length;
      return [
        ...escolhidas.flatMap((l) => {
          const cultura = c.culturas().find((x) => x.id === l.cultura);
          const kc = cultura?.fases[l.fase]?.kc ?? 1;
          const b = balancoHidrico(p, kc, 7, 2, l.irrigouEm, new Date(), medida);
          const nome = c.plantas().find((x) => x.id === l.planta)?.nome ?? l.planta;
          const semana = aguaDaSemana(p, kc);
          return [
            `${nome}: fase ${cultura?.fases[l.fase]?.nome ?? l.fase} (Kc ${kc}), ${l.irrigada ? 'irrigada' : 'sem irrigação'} · déficit ${b.deficit} mm em 7 dias${b.medidos ? ` (chuva do pluviômetro em ${b.medidos} dia(s))` : ''} · chuva prevista em 2 dias ${b.chuvaPrevista} mm`,
            `  Próximos 7 dias: deve usar ~${semana.usa} mm (litros por m²), chuva prevista ${semana.chuva} mm, faltam ~${semana.falta} mm`,
          ];
        }),
        dias
          ? 'A chuva que já caiu usa o pluviômetro da pessoa nos dias que ela informou; nos outros, a estimativa do modelo.'
          : 'A chuva que já caiu é estimada pelo modelo: se a pessoa tiver pluviômetro, ela pode dizer quanto choveu ("choveu 18 mm ontem") e a conta fica mais certa.',
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
        lugar: LUGAR,
      },
      required: ['planta'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      if (!ctx.userId) throw new UserFacingError('Só dá para registrar plantas numa conversa identificada.');
      const lugarId = lugarDe(args, ctx.userId);
      const planta = c.plantas().find((p) => p.id === args.planta);
      if (!planta) throw new UserFacingError('Não conheço essa planta.');
      if (args.remover === true) {
        banco.removerLavoura(ctx.userId, planta.id, lugarId);
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
      }, lugarId);
      return `ok: ${planta.nome} registrada em ${banco.lugarPorId(ctx.userId, lugarId)!.nome}${l.plantio ? `, plantio ${l.plantio}` : ''}${l.irrigada ? ', irrigada' : ''}.`;
    },
  });

  k7.ferramenta(avisosAutomaticos(c));

  k7.ferramenta({
    name: 'melhor_hora_pulverizar',
    description:
      'A melhor hora para pulverizar hoje e nos próximos dias, hora a hora, com o motivo das horas ruins (vento, calor, ar seco, ' +
      'chuva logo depois) e a próxima janela boa. Use para "que horas posso pulverizar?", "dá para aplicar amanhã de manhã?". ' +
      'Nunca indique produto nem dose.',
    parameters: {
      type: 'object',
      properties: { dias: { type: 'integer', description: 'Quantos dias olhar, de 1 a 3 (padrão 2: hoje e amanhã)' }, lugar: LUGAR },
      additionalProperties: false,
    },
    async run(args, ctx) {
      const lugar = lugarOuErro(c, ctx.userId, lugarDe(args, ctx.userId));
      const regra = c.regras().find((r) => r.id === 'pulverizacao') ?? c.regras().find((r) => r.tipo === 'janela');
      if (!regra) throw new UserFacingError('A regra de pulverização não está em regras/clima.yaml.');
      const dias = typeof args.dias === 'number' ? Math.min(3, Math.max(1, Math.round(args.dias))) : 2;
      const p = await c.meteo.previsao(lugar.celula);
      const agora = new Date();
      return textoPulverizacao(horasDePulverizar(p, regra, agora, dias), regra, lugar.nome, p, agora, dias);
    },
  });

  k7.ferramenta({
    name: 'registrar_chuva',
    description:
      'Registra a chuva que a pessoa mediu no pluviômetro ("choveu 18 mm ontem", "deu 5 milímetros hoje"). Passa a valer no lugar da ' +
      'estimativa do modelo na conta de água (irrigação) daquele dia, e fica no caderno de campo. mm negativo apaga o registro do dia.',
    parameters: {
      type: 'object',
      properties: {
        mm: { type: 'number', description: 'Milímetros medidos (1 mm = 1 litro por m²)' },
        dia: { type: 'string', description: 'hoje (padrão), ontem, anteontem, AAAA-MM-DD ou DD/MM' },
        lugar: LUGAR,
      },
      required: ['mm'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const lugar = lugarOuErro(c, ctx.userId, lugarDe(args, ctx.userId));
      const mm = Number(args.mm);
      if (!Number.isFinite(mm) || mm > 400) throw new UserFacingError('Quantidade de chuva inválida: informe os milímetros do pluviômetro (de 0 a 400).');
      const dia = diaDe(args.dia, hojeLocal());
      if (!dia) throw new UserFacingError('Não entendi o dia: use hoje, ontem, anteontem ou a data (DD/MM), de até um ano atrás.');
      banco.registrarChuva(lugar.userId, lugar.id, dia, mm);
      if (mm < 0) return `ok: apagada a chuva medida de ${dia} em ${lugar.nome}; nesse dia volta a valer a estimativa do modelo.`;
      banco.anotar({ userId: lugar.userId, lugarId: lugar.id, dia, tipo: 'chuva', texto: 'pluviômetro', planta: null, quantidade: mm, unidade: 'mm' });
      return (
        `ok: ${String(mm).replace('.', ',')} mm em ${dia} anotados em ${lugar.nome}. A conta de água (irrigação) passa a usar essa medida ` +
        'nesse dia, no lugar da estimativa do modelo. Confirme em uma frase.'
      );
    },
  });

  k7.ferramenta({
    name: 'anotar_caderno',
    description:
      'Anota no caderno de campo o que a pessoa fez ou viu na roça, quando ela contar (inclusive por áudio): aplicação, adubação, ' +
      'irrigação, plantio, colheita, observação ("apliquei fungicida no milho hoje", "adubei a horta ontem", "colhi 40 caixas de tomate", ' +
      '"vi lagarta na couve"). Uma chamada por anotação. Só registra: não recomende produto nem dose.',
    parameters: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'O que foi feito, nas palavras da pessoa, curto ("fungicida no talhão 2", "lagarta nas folhas")' },
        tipo: { type: 'string', enum: Object.keys(TIPOS), description: 'aplicacao, adubacao, irrigacao, plantio, colheita, chuva, observacao ou outro' },
        dia: { type: 'string', description: 'Quando aconteceu: hoje (padrão), ontem, anteontem, AAAA-MM-DD ou DD/MM' },
        planta: { type: 'string', enum: idsPlantas(), description: 'Planta, quando a pessoa disser' },
        quantidade: { type: 'number', description: 'Quantidade, quando houver (40 caixas, 2 sacos, 300 litros)' },
        unidade: { type: 'string', description: 'Unidade da quantidade (caixas, kg, sacos, litros, mm)' },
        lugar: LUGAR,
      },
      required: ['texto', 'tipo'],
      additionalProperties: false,
    },
    async run(args, ctx) {
      const lugar = lugarOuErro(c, ctx.userId, lugarDe(args, ctx.userId));
      if (!ehTipo(args.tipo)) throw new UserFacingError('Tipo de anotação inválido.');
      const texto = String(args.texto ?? '').trim();
      if (!texto) throw new UserFacingError('Faltou dizer o que foi feito.');
      const hoje = hojeLocal();
      const dia = diaDe(args.dia, hoje);
      if (!dia) throw new UserFacingError('Não entendi o dia: use hoje, ontem, anteontem ou a data (DD/MM), de até um ano atrás.');
      const planta = typeof args.planta === 'string' && c.plantas().some((p) => p.id === args.planta) ? args.planta : null;
      const quantidade = typeof args.quantidade === 'number' && Number.isFinite(args.quantidade) ? args.quantidade : null;
      const unidade = typeof args.unidade === 'string' ? args.unidade : null;
      const a = banco.anotar({ userId: lugar.userId, lugarId: lugar.id, dia, tipo: args.tipo, texto, planta, quantidade, unidade });
      const extras: string[] = [];
      // Irrigação de hoje ou de ontem zera a conta de água (como o /irriguei).
      if (args.tipo === 'irrigacao' && dia >= somarDias(hoje, -1)) {
        banco.irrigou(lugar.userId, planta ?? undefined, lugar.id);
        extras.push('a conta de água das plantas irrigadas recomeçou');
      }
      if (args.tipo === 'chuva' && quantidade !== null && /^mm|mil[ií]metros?$/i.test(unidade ?? 'mm')) {
        banco.registrarChuva(lugar.userId, lugar.id, dia, quantidade);
        extras.push('a chuva medida passa a valer na conta de água desse dia');
      }
      const nome = (id: string) => c.plantas().find((p) => p.id === id)?.nome ?? id;
      return `ok: anotado no caderno de ${lugar.nome}: ${linhaDaAnotacao(a, nome).slice(2)}${extras.length ? ` (${extras.join('; ')})` : ''}. Confirme em uma frase.`;
    },
  });

  k7.ferramenta({
    name: 'ver_caderno',
    description:
      'O caderno de campo da pessoa: o que ela anotou (aplicações, adubações, irrigações, colheitas, chuva medida, observações), ' +
      'com um resumo e o total colhido. Use para "o que eu apliquei este mês?", "quando adubei?", "quanto colhi de tomate?".',
    parameters: {
      type: 'object',
      properties: {
        dias: { type: 'integer', description: 'Quantos dias para trás (padrão 30, até 366)' },
        tipo: { type: 'string', enum: Object.keys(TIPOS), description: 'Só um tipo de anotação' },
        planta: { type: 'string', enum: idsPlantas(), description: 'Só uma planta' },
        lugar: LUGAR,
      },
      additionalProperties: false,
    },
    async run(args, ctx) {
      const lugar = lugarOuErro(c, ctx.userId, lugarDe(args, ctx.userId));
      const dias = typeof args.dias === 'number' ? Math.min(366, Math.max(1, Math.round(args.dias))) : 30;
      const anotacoes = banco.caderno(lugar.userId, {
        lugarId: lugar.id,
        desde: somarDias(hojeLocal(), -dias),
        ...(ehTipo(args.tipo) ? { tipo: args.tipo } : {}),
        ...(typeof args.planta === 'string' ? { planta: args.planta } : {}),
        limite: 500,
      });
      const nome = (id: string) => c.plantas().find((p) => p.id === id)?.nome ?? id;
      return textoCaderno(anotacoes, lugar.nome, dias, nome);
    },
  });

  k7.ferramenta({
    name: 'meus_lugares',
    description: 'Os lugares da pessoa (fazenda, sítio, horta de casa) e quantas plantas tem em cada; qual está em uso. Use quando ela perguntar dos lugares ou citar um que você não conhece.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, ctx) {
      lugarOuErro(c, ctx.userId);
      return [
        ...banco.lugaresDe(ctx.userId!).map((l) => `${l.atual ? '● (em uso) ' : ''}${l.nome}: ${banco.lavouras(ctx.userId!, l.id).length} planta(s)`),
        peloTelegram(ctx.userId)
          ? 'Para acrescentar: mande outra localização (dá para arrastar o mapa). Trocar ou remover: /lugares.'
          : 'Para acrescentar, trocar ou remover: o botão 📍 ao lado da caixa de mensagem.',
      ].join('\n');
    },
  });
}

const MODOS_AVISO: Record<ModoEnvio, string> = {
  boletim: 'boletim nos horários e alerta grave na hora',
  hora: 'boletim nos horários e todo alerta novo, de hora em hora',
  alertas: 'só os alertas, sem boletim',
  pedir: 'nada automático, só quando a pessoa pedir',
};

const horas = (lista: number[]) => lista.map((h) => `${h}h`).join(', ').replace(/, ([^,]*)$/, ' e $1');

/**
 * avisos_automaticos: a pessoa pede pela conversa ("me mande o tempo todo dia de manhã", "pare de mandar") e o
 * agente liga, ajusta, pausa ou mostra o boletim automático. Mensagem sem ser resposta só existe no Telegram: no chat
 * web a ferramenta explica onde receber.
 */
export function avisosAutomaticos(c: Contexto): FitaTool {
  return {
    name: 'avisos_automaticos',
    description:
      'Liga, ajusta, pausa ou mostra o boletim automático do tempo (mensagem que a fita manda sozinha todo dia nos horários escolhidos, ' +
      'mais os alertas de risco). Use quando a pessoa pedir para receber o tempo diariamente, mudar o horário, parar ou voltar a receber.',
    parameters: {
      type: 'object',
      properties: {
        acao: { type: 'string', enum: ['ver', 'ligar', 'pausar', 'voltar'], description: 'ver (como está), ligar (ou ajustar), pausar, voltar (depois de pausar).' },
        horarios: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Horas do boletim, de 0 a 23, na hora do lugar (ex.: [6] "de manhã cedo", [6, 18] "manhã e fim de tarde"). Sem pedido de horário, não passe: fica como está.',
        },
        modo: {
          type: 'string',
          enum: ['boletim', 'hora', 'alertas', 'pedir'],
          description: 'boletim (padrão: boletim nos horários e alerta grave na hora), hora (também todo alerta novo), alertas (só alertas), pedir (nada automático).',
        },
        audio: { type: 'boolean', description: 'true: boletim e alertas também em áudio (mensagem de voz); false: só imagem e texto. Sem pedido, não passe.' },
      },
      required: ['acao'],
      additionalProperties: false,
    },

    async run(args, ctx) {
      if (!peloTelegram(ctx.userId)) {
        return (
          'Aqui no chat do navegador eu só respondo quando a pessoa escreve: não consigo mandar mensagem sozinho. ' +
          'Para receber o boletim todo dia, é pelo Telegram: o botão ✈️ no alto da página abre a conversa com o bot ' +
          '(lá ela manda a localização da plantação uma vez e escolhe os horários). Explique isso em poucas frases.'
        );
      }
      const banco = c.banco;
      const lugar = lugarOuErro(c, ctx.userId);
      const userId = ctx.userId!;
      const acao = String(args.acao ?? 'ver');
      if (acao === 'pausar') banco.salvarPreferencias(userId, { pausado: true });
      else if (acao === 'voltar') banco.salvarPreferencias(userId, { pausado: false });
      else if (acao === 'ligar') {
        const pedidas = Array.isArray(args.horarios) ? args.horarios.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23) : [];
        const lista = [...new Set(pedidas)].sort((a, b) => a - b).slice(0, 4);
        if (Array.isArray(args.horarios) && args.horarios.length && !lista.length) throw new UserFacingError('Horário inválido: use horas de 0 a 23.');
        const atual = banco.preferencias(userId);
        const modo = typeof args.modo === 'string' && args.modo in MODOS_AVISO ? (args.modo as ModoEnvio) : atual.modo === 'pedir' ? 'boletim' : atual.modo;
        banco.salvarPreferencias(userId, { modo, pausado: false, ...(lista.length ? { horarios: lista } : {}) });
      }
      if (typeof args.audio === 'boolean') banco.salvarPreferencias(userId, { audio: args.audio });
      const p = banco.preferencias(userId);
      const comBoletim = p.modo === 'boletim' || p.modo === 'hora';
      return [
        `ok: ${p.pausado ? 'PAUSADO (nada é enviado até a pessoa pedir para voltar)' : MODOS_AVISO[p.modo]}` +
          `${comBoletim && !p.pausado ? `, todo dia às ${horas(p.horarios)} (hora de ${lugar.nome})` : ''}` +
          `${p.audio ? ', também em áudio (mensagem de voz)' : ''}.`,
        'Entre 22h e 6h só vão alertas graves. Para mudar pelos botões: /alertas; parar: /pausar; áudio: /audio.',
        'Confirme em uma frase o que ficou valendo.',
      ].join('\n');
    },
  };
}
