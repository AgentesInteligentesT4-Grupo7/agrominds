import type { ModoEnvio } from './Banco.js';
import type { TelegramBotao, TelegramCtx, TelegramResposta } from './k7.js';
import { GRUPOS, type Planta, somarDias } from './Plantas.js';
import { type Contexto, calendarioDe, hojeLocal, minhasPlantas, nomesPedidos, previsaoDoPeriodo, tempoAgora } from './Servicos.js';
import { PERIODOS, ehPeriodo } from './Visual.js';

export type { Contexto } from './Servicos.js';

const MODOS: Record<ModoEnvio, string> = {
  boletim: '🗓️ Boletim nos horários (e alertas graves na hora)',
  hora: '⏱️ Boletim + todo alerta novo, de hora em hora',
  alertas: '⚠️ Só alertas',
  pedir: '🙊 Só quando eu pedir (/clima)',
};

const HORARIOS: Record<string, number[]> = { '6-18': [6, 18], '6': [6], '6-12-18': [6, 12, 18], '18': [18] };

/** Quando plantou: rótulo e dias atrás (`vai` = ainda vai plantar). */
const PLANTOU: Array<[string, string]> = [
  ['vai', 'Ainda vou plantar'],
  ['3', 'Nesta semana'],
  ['30', 'Há ~1 mês'],
  ['60', 'Há ~2 meses'],
  ['90', 'Há ~3 meses'],
  ['120', 'Há 4 meses ou mais'],
];

/** Botões em linhas de até `porLinha`. */
function grade(botoes: TelegramBotao[], porLinha = 2): TelegramBotao[][] {
  const linhas: TelegramBotao[][] = [];
  for (let i = 0; i < botoes.length; i += porLinha) linhas.push(botoes.slice(i, i + porLinha));
  return linhas;
}

type Responde = Pick<TelegramCtx, 'responder' | 'userId'>;

/**
 * Conversa da AgroMinds no Telegram, para quem planta em qualquer escala (roça, sítio, horta, vaso):
 * localização → plantas (várias) → quando plantou / fase → irrigação; /clima, /previsao, /plantas, /calendario,
 * /plantar, /alertas, /esquecer. O que tem dados vai como imagem (layouts/), com legenda curta.
 */
export function registrarTelegram(c: Contexto): void {
  const { k7, banco } = c;
  const planta = (id: string | undefined) => c.plantas().find((p) => p.id === id);

  const escolhidas = (userId: string) => {
    const nomes = banco.lavouras(userId).map((l) => planta(l.planta)?.nome ?? l.planta);
    return nomes.length ? `Escolhidas: ${nomes.join(', ')}.` : 'Nenhuma escolhida ainda.';
  };

  const menuGrupos = (userId: string, intro = '🌱 O que você planta (ou quer plantar)? Pode escolher quantas quiser.'): TelegramResposta => ({
    texto: `${intro}\n\n${escolhidas(userId)}`,
    botoes: [
      Object.entries(GRUPOS).map(([id, nome]) => ({ texto: nome, dados: `agro:grupo:${id}` })),
      [{ texto: '💡 Não sei: me sugira o que plantar agora', dados: 'agro:sug:todas' }],
      [{ texto: '✅ Pronto', dados: 'agro:pronto' }],
    ],
  });

  const menuGrupo = (userId: string, grupo: Planta['grupo']): TelegramResposta => {
    const minhas = new Set(banco.lavouras(userId).map((l) => l.planta));
    return {
      texto: `${GRUPOS[grupo]}: toque para marcar ou desmarcar.\n\n${escolhidas(userId)}`,
      botoes: [
        ...grade(c.plantas().filter((p) => p.grupo === grupo).map((p) => ({ texto: `${minhas.has(p.id) ? '✅ ' : ''}${p.nome}`, dados: `agro:sel:${p.id}` })), 3),
        [{ texto: '⬅️ Voltar', dados: 'agro:grupos' }, { texto: '✅ Pronto', dados: 'agro:pronto' }],
      ],
    };
  };

  /** Próxima pergunta do cadastro: quando plantou (ou a fase, nas perenes); depois, a irrigação; e o resumo. */
  const proximaPergunta = async (ctx: Responde): Promise<void> => {
    const lavouras = banco.lavouras(ctx.userId);
    const pendente = lavouras.find((l) => l.pendente);
    if (pendente) {
      const p = planta(pendente.planta);
      const cultura = c.culturas().find((x) => x.id === pendente.cultura);
      if (p?.perene && cultura) {
        await ctx.responder({ texto: `Em que fase está ${artigo(p.nome)} ${p.nome.toLowerCase()}?`, botoes: grade(Object.entries(cultura.fases).map(([id, f]) => ({ texto: f.nome, dados: `agro:fase:${p.id}:${id}` }))) });
        return;
      }
      await ctx.responder({ texto: `🗓️ Quando você plantou ${artigo(p?.nome ?? '')} ${(p?.nome ?? pendente.planta).toLowerCase()}?`, botoes: grade(PLANTOU.map(([dias, rotulo]) => ({ texto: rotulo, dados: `agro:plantou:${pendente.planta}:${dias}` }))) });
      return;
    }
    if (lavouras.some((l) => planta(l.planta)?.grupo === 'lavoura') && !lavouras.some((l) => l.irrigada) && !perguntouIrrigacao.has(ctx.userId)) {
      perguntouIrrigacao.add(ctx.userId);
      await ctx.responder(menuIrrigacao(ctx.userId));
      return;
    }
    await concluir(ctx);
  };
  const perguntouIrrigacao = new Set<string>();

  const menuIrrigacao = (userId: string): TelegramResposta => ({
    texto: '💧 Alguma tem irrigação? Marque as irrigadas (assim eu aviso quando vale irrigar).',
    botoes: [
      ...grade(banco.lavouras(userId).map((l) => ({ texto: `${l.irrigada ? '💧 ' : ''}${planta(l.planta)?.nome ?? l.planta}`, dados: `agro:irr:${l.planta}` })), 3),
      [{ texto: '✅ Pronto', dados: 'agro:irr-ok' }],
    ],
  });

  const concluir = async (ctx: Responde) => {
    const p = banco.preferencias(ctx.userId);
    if (!banco.lavouras(ctx.userId).length) {
      await ctx.responder({
        texto: `✅ Pronto! Mando o tempo e os alertas às ${p.horarios.map((h) => `${h}h`).join(' e ')}. Quando quiser, diga o que planta em /plantas.`,
        botoes: [[{ texto: '💡 O que plantar agora?', dados: 'agro:sug:todas' }]],
      });
      return;
    }
    await ctx.responder((await minhasPlantas(c, ctx.userId)).mensagem);
    await ctx.responder(
      `✅ Pronto! Boletim às ${p.horarios.map((h) => `${h}h`).join(' e ')} e aviso na hora se aparecer risco grave.\n` +
        '/clima o tempo agora · /previsao por período · /plantas suas plantas · /calendario época de plantio · /alertas como receber',
    );
  };

  k7.telegram.comando('start', 'Começar', async (ctx) => {
    const lugar = banco.lugar(ctx.userId);
    await ctx.responder({
      texto:
        `🌱 Oi, ${ctx.nome.split(' ')[0]}! Eu aviso sobre o tempo onde você planta — roça, sítio, horta ou vaso em casa — e mostro ` +
        'a época de plantar cada planta na sua cidade: boletim do dia, geada, chuva forte, vento, hora boa para pulverizar e quando irrigar.\n\n' +
        (lugar ? `Seu lugar: ${lugar.nome}. Para trocar, mande a localização de novo.` : 'Toque no botão abaixo para mandar a sua localização.') +
        '\n\n🔒 Guardo só o lugar aproximado (~1 km), o que você planta e as mensagens que eu mandar. /esquecer apaga tudo.',
      pedirLocalizacao: '📍 Enviar minha localização',
    });
  });

  k7.telegram.aoLocalizacao(async (ctx) => {
    const { nome, uf } = await c.nomeDoLugar(ctx.lat, ctx.lon);
    banco.salvarLugar(ctx.userId, nome, ctx.lat, ctx.lon, uf);
    banco.salvarPreferencias(ctx.userId, {});
    if (banco.lavouras(ctx.userId).length) return ctx.responder(`📍 Lugar atualizado: ${nome}. Use /clima para ver o tempo.`);
    await ctx.responder(menuGrupos(ctx.userId, `📍 Recebi: ${nome}.\n\n🌱 O que você planta (ou quer plantar)? Pode escolher quantas quiser.`));
  });

  k7.telegram.botoes('agro', async (ctx) => {
    const [, campo, valor, extra] = ctx.dados.split(':');
    if (campo === 'grupos') return ctx.editar(menuGrupos(ctx.userId));
    if (campo === 'mudar') return ctx.responder(menuGrupos(ctx.userId));
    if (campo === 'grupo' && (valor === 'lavoura' || valor === 'horta')) return ctx.editar(menuGrupo(ctx.userId, valor));
    if (campo === 'sel') {
      const p = planta(valor);
      if (!p) return;
      if (banco.lavoura(ctx.userId, p.id)) banco.removerLavoura(ctx.userId, p.id);
      else {
        const cultura = c.culturas().find((x) => x.id === p.cultura);
        // Lavoura e perenes: falta perguntar quando plantou (ou a fase). Horta: entra direto, sem perguntas.
        banco.salvarLavoura(ctx.userId, p.id, { cultura: p.cultura, fase: cultura?.fases.vegetativo ? 'vegetativo' : Object.keys(cultura?.fases ?? { vegetativo: 1 })[0]!, pendente: p.grupo === 'lavoura' || p.perene });
      }
      return ctx.editar(menuGrupo(ctx.userId, p.grupo));
    }
    if (campo === 'pronto') {
      await ctx.editar(`🌱 ${escolhidas(ctx.userId)}`);
      return proximaPergunta(ctx);
    }
    if (campo === 'plantou' && valor && extra) {
      const p = planta(valor);
      if (!p || !banco.lavoura(ctx.userId, valor)) return;
      const vai = extra === 'vai';
      banco.salvarLavoura(ctx.userId, valor, { plantio: vai ? null : somarDias(hojeLocal(), -Number(extra)), ...(vai ? { fase: 'preparo' } : {}), pendente: false });
      await ctx.editar(`🗓️ ${p.nome}: ${PLANTOU.find(([d]) => d === extra)?.[1].toLowerCase() ?? ''}`);
      return proximaPergunta(ctx);
    }
    if (campo === 'fase' && valor && extra) {
      const l = banco.lavoura(ctx.userId, valor);
      const fase = c.culturas().find((x) => x.id === l?.cultura)?.fases[extra];
      if (!l || !fase) return;
      banco.salvarLavoura(ctx.userId, valor, { fase: extra, pendente: false });
      await ctx.editar(`📅 ${planta(valor)?.nome ?? valor}: ${fase.nome.toLowerCase()}`);
      return proximaPergunta(ctx);
    }
    if (campo === 'irrigacao') {
      perguntouIrrigacao.add(ctx.userId);
      return ctx.responder(menuIrrigacao(ctx.userId));
    }
    if (campo === 'irr' && valor) {
      const l = banco.lavoura(ctx.userId, valor);
      if (!l) return;
      banco.salvarLavoura(ctx.userId, valor, { irrigada: !l.irrigada });
      return ctx.editar(menuIrrigacao(ctx.userId));
    }
    if (campo === 'irr-ok') {
      await ctx.editar(`💧 Irrigadas: ${banco.lavouras(ctx.userId).filter((l) => l.irrigada).map((l) => planta(l.planta)?.nome ?? l.planta).join(', ') || 'nenhuma'}.`);
      return concluir(ctx);
    }
    if (campo === 'sug') {
      const grupo = valor === 'horta' || valor === 'lavoura' ? valor : undefined;
      return ctx.responder(comBotoes(await calendarioDe(c, ctx.userId, { todas: true, sugerir: true, ...(grupo ? { grupo } : {}) }), BOTOES_SUGESTAO));
    }
    if (campo === 'cal') {
      const grupo = valor === 'horta' || valor === 'lavoura' ? valor : undefined;
      return ctx.responder(comBotoes(await calendarioDe(c, ctx.userId, { ...(valor === 'todas' ? { todas: true } : {}), ...(grupo ? { grupo } : {}) }), BOTOES_CALENDARIO));
    }
    if (campo === 'prev' && ehPeriodo(valor)) return ctx.responder((await previsaoDoPeriodo(c, ctx.userId, valor)).mensagem);
    if (campo === 'modo' && valor && valor in MODOS) {
      banco.salvarPreferencias(ctx.userId, { modo: valor as ModoEnvio, pausado: false });
      return ctx.editar(menuAlertas(ctx.userId));
    }
    if (campo === 'horas' && valor && HORARIOS[valor]) {
      banco.salvarPreferencias(ctx.userId, { horarios: HORARIOS[valor]! });
      return ctx.editar(menuAlertas(ctx.userId));
    }
    if (campo === 'esquecer' && valor === 'sim') {
      banco.esquecer(ctx.userId);
      return ctx.editar('🗑️ Pronto: apaguei seu lugar, suas plantas, suas preferências e as mensagens que mandei. Para voltar, /start.');
    }
    if (campo === 'esquecer') return ctx.editar('Ok, nada foi apagado.');
  });

  const menuAlertas = (userId: string): TelegramResposta => {
    const p = banco.preferencias(userId);
    return {
      texto: `🔔 Como você quer receber?\nAgora: ${MODOS[p.modo]}${p.pausado ? ' (pausado)' : ''} · boletim às ${p.horarios.map((h) => `${h}h`).join(' e ')}.`,
      botoes: [
        ...Object.entries(MODOS).map(([id, nome]) => [{ texto: (p.modo === id ? '● ' : '') + nome, dados: `agro:modo:${id}` }]),
        Object.keys(HORARIOS).map((id) => ({ texto: `${id.replace(/-/g, 'h, ')}h`, dados: `agro:horas:${id}` })),
      ],
    };
  };

  k7.telegram.comando('clima', 'O tempo agora, os próximos dias e o que fazer', async (ctx) => {
    if (!banco.lugar(ctx.userId)) return ctx.responder({ texto: 'Primeiro me mande a sua localização.', pedirLocalizacao: '📍 Enviar minha localização' });
    const s = await tempoAgora(c, ctx.userId, 'clima');
    await ctx.responder(s.mensagem);
    banco.registrarEnvio({ userId: ctx.userId, tipo: 'resposta', regras: s.resultados.map((r) => r.regra), severidade: null, texto: s.texto, entregue: true, erro: null });
  });

  k7.telegram.comando('previsao', 'Previsão para o período que você escolher (até 14 dias)', async (ctx) => {
    if (!banco.lugar(ctx.userId)) return ctx.responder({ texto: 'Primeiro me mande a sua localização.', pedirLocalizacao: '📍 Enviar minha localização' });
    const pedido = ctx.args.trim().toLowerCase().replace('amanhã', 'amanha').replace(/fim de semana|fds/, 'fds').replace(/\s*dias?$/, '');
    if (ehPeriodo(pedido)) return ctx.responder((await previsaoDoPeriodo(c, ctx.userId, pedido)).mensagem);
    await ctx.responder({ texto: '🌦️ Previsão para quando?', botoes: grade(PERIODOS.map(([id, nome]) => ({ texto: nome, dados: `agro:prev:${id}` })), 3) });
  });

  k7.telegram.comando('plantas', 'O que você planta: fases, colheita e época de plantio', async (ctx) => {
    if (!banco.lugar(ctx.userId)) return ctx.responder({ texto: 'Primeiro me mande a sua localização.', pedirLocalizacao: '📍 Enviar minha localização' });
    if (!banco.lavouras(ctx.userId).length) return ctx.responder(menuGrupos(ctx.userId, '🌱 Você ainda não me disse o que planta. O que é? Pode escolher quantas quiser.'));
    await ctx.responder(
      comBotoes(await minhasPlantas(c, ctx.userId), [
        [{ texto: '✏️ Mudar plantas', dados: 'agro:mudar' }, { texto: '💧 Irrigação', dados: 'agro:irrigacao' }],
        [{ texto: '📅 Calendário', dados: 'agro:cal' }, { texto: '💡 O que plantar agora', dados: 'agro:sug:todas' }],
      ]),
    );
  });

  k7.telegram.comando('calendario', 'Época de plantio na sua cidade (ex.: /calendario feijão, couve)', async (ctx) => {
    if (!banco.lugar(ctx.userId)) return ctx.responder({ texto: 'Primeiro me mande a sua localização.', pedirLocalizacao: '📍 Enviar minha localização' });
    await ctx.responder(comBotoes(await calendarioDe(c, ctx.userId, { incluir: nomesPedidos(ctx.args) }), BOTOES_CALENDARIO));
  });

  k7.telegram.comando('plantar', 'O que dá para plantar agora (ex.: /plantar feijão, couve)', async (ctx) => {
    if (!banco.lugar(ctx.userId)) return ctx.responder({ texto: 'Primeiro me mande a sua localização.', pedirLocalizacao: '📍 Enviar minha localização' });
    await ctx.responder(comBotoes(await calendarioDe(c, ctx.userId, { todas: true, sugerir: true, incluir: nomesPedidos(ctx.args) }), BOTOES_SUGESTAO));
  });

  k7.telegram.comando('alertas', 'Como e quando receber o boletim e os alertas', (ctx) => ctx.responder(menuAlertas(ctx.userId)));
  k7.telegram.comando('pausar', 'Parar as notificações (ex.: entressafra)', async (ctx) => {
    banco.salvarPreferencias(ctx.userId, { pausado: true });
    await ctx.responder('⏸️ Notificações pausadas. /voltar para receber de novo.');
  });
  k7.telegram.comando('voltar', 'Voltar a receber as notificações', async (ctx) => {
    banco.salvarPreferencias(ctx.userId, { pausado: false });
    await ctx.responder('▶️ Voltei a mandar o boletim e os alertas.');
  });
  k7.telegram.comando('irriguei', 'Avisar que irrigou (zera a conta de água)', async (ctx) => {
    banco.irrigou(ctx.userId);
    await ctx.responder('💧 Anotado: a conta de água das plantas irrigadas recomeça a partir de hoje.');
  });
  k7.telegram.comando('esquecer', 'Apagar meu lugar, minhas plantas e minhas mensagens', (ctx) =>
    ctx.responder({ texto: 'Apagar seu lugar, suas plantas, suas preferências e as mensagens que mandei?', botoes: [[{ texto: '🗑️ Apagar', dados: 'agro:esquecer:sim' }, { texto: 'Cancelar', dados: 'agro:esquecer:nao' }]] }),
  );
}

const BOTOES_CALENDARIO: TelegramBotao[][] = [[{ texto: '🥬 Horta', dados: 'agro:cal:horta' }, { texto: '🚜 Lavoura', dados: 'agro:cal:lavoura' }, { texto: '📋 Todas', dados: 'agro:cal:todas' }]];
const BOTOES_SUGESTAO: TelegramBotao[][] = [[{ texto: '🥬 Só horta e pomar', dados: 'agro:sug:horta' }, { texto: '🚜 Só lavoura', dados: 'agro:sug:lavoura' }]];

/** Põe botões na mensagem (imagem ou texto). */
function comBotoes(s: { mensagem: string | TelegramResposta }, botoes: TelegramBotao[][]): TelegramResposta {
  return typeof s.mensagem === 'string' ? { texto: s.mensagem, botoes } : { ...s.mensagem, botoes };
}

/** "a soja", "o milho" (para as perguntas soarem naturais). */
function artigo(nome: string): string {
  return /([aã]|ce|ve|gem)$/i.test(nome.split(/[\s(-]/)[0]!) ? 'a' : 'o';
}
