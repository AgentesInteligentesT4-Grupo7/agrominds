import type { Banco, ModoEnvio } from './Banco.js';
import type { FitaApi, TelegramBotao, TelegramCtx } from './k7.js';
import { cartaoSvg, comCartao } from './Cartao.js';
import { mensagemClima } from './Mensagens.js';
import type { Notificador } from './Notificador.js';
import type { OpenMeteo } from './OpenMeteo.js';
import { type Cultura, type Regra, avaliarRegras } from './Regras.js';

export interface Contexto {
  k7: FitaApi;
  banco: Banco;
  meteo: OpenMeteo;
  notificador: Notificador;
  regras: () => Regra[];
  culturas: () => Cultura[];
  /** Nome legível do lugar (cidade/UF) a partir da coordenada; sem rede, devolve a coordenada. */
  nomeDoLugar: (lat: number, lon: number) => Promise<string>;
}

const MODOS: Record<ModoEnvio, string> = {
  boletim: '🗓️ Boletim nos horários (e alertas graves na hora)',
  hora: '⏱️ Boletim + todo alerta novo, de hora em hora',
  alertas: '⚠️ Só alertas',
  pedir: '🙊 Só quando eu pedir (/clima)',
};

const HORARIOS: Record<string, number[]> = { '6-18': [6, 18], '6': [6], '6-12-18': [6, 12, 18], '18': [18] };

/** Botões em linhas de até `porLinha`. */
function grade(botoes: TelegramBotao[], porLinha = 2): TelegramBotao[][] {
  const linhas: TelegramBotao[][] = [];
  for (let i = 0; i < botoes.length; i += porLinha) linhas.push(botoes.slice(i, i + porLinha));
  return linhas;
}

/** Conversa da AgroMinds no Telegram: localização → cultura → fase → irrigada, /clima, /lavoura, /alertas, /esquecer. */
export function registrarTelegram(c: Contexto): void {
  const { k7, banco } = c;

  const perguntarCultura = (ctx: TelegramCtx, texto = '🌾 O que você planta aí?') =>
    ctx.responder({ texto, botoes: grade(c.culturas().map((x) => ({ texto: x.nome, dados: `agro:cultura:${x.id}` })), 3) });

  const perguntarFase = (ctx: { responder: TelegramCtx['responder'] }, cultura: Cultura) =>
    ctx.responder({ texto: `Em que fase está a lavoura de ${cultura.nome.toLowerCase()}?`, botoes: grade(Object.entries(cultura.fases).map(([id, f]) => ({ texto: f.nome, dados: `agro:fase:${id}` }))) });

  const menuAlertas = (userId: string) => {
    const p = banco.preferencias(userId);
    return {
      texto: `🔔 Como você quer receber?\nAgora: ${MODOS[p.modo]}${p.pausado ? ' (pausado)' : ''} · boletim às ${p.horarios.map((h) => `${h}h`).join(' e ')}.`,
      botoes: [
        ...Object.entries(MODOS).map(([id, nome]) => [{ texto: (p.modo === id ? '● ' : '') + nome, dados: `agro:modo:${id}` }]),
        Object.keys(HORARIOS).map((id) => ({ texto: `${id.replace(/-/g, 'h, ')}h`, dados: `agro:horas:${id}` })),
      ],
    };
  };

  k7.telegram.comando('start', 'Começar', async (ctx) => {
    const lugar = banco.lugar(ctx.userId);
    await ctx.responder({
      texto:
        `🌱 Oi, ${ctx.nome.split(' ')[0]}! Eu aviso sobre o tempo na sua lavoura: boletim do dia, risco de geada, chuva forte, ` +
        'vento, hora boa para pulverizar e quando irrigar.\n\n' +
        (lugar ? `Seu lugar: ${lugar.nome}. Para trocar, mande a localização de novo.` : 'Toque no botão abaixo para mandar a localização da roça.') +
        '\n\n🔒 Guardo só o lugar aproximado (~1 km), o que você planta e as mensagens que eu mandar. /esquecer apaga tudo.',
      pedirLocalizacao: '📍 Enviar localização da roça',
    });
  });

  k7.telegram.aoLocalizacao(async (ctx) => {
    const nome = await c.nomeDoLugar(ctx.lat, ctx.lon);
    banco.salvarLugar(ctx.userId, nome, ctx.lat, ctx.lon);
    if (!banco.preferencias(ctx.userId).horarios.length) banco.salvarPreferencias(ctx.userId, {});
    if (banco.lavoura(ctx.userId)) return ctx.responder(`📍 Lugar atualizado: ${nome}. Use /clima para ver o tempo.`);
    await perguntarCultura(ctx, `📍 Recebi: ${nome}.\n\n🌾 O que você planta aí?`);
  });

  k7.telegram.botoes('agro', async (ctx) => {
    const [, campo, valor] = ctx.dados.split(':');
    if (campo === 'cultura') {
      const cultura = c.culturas().find((x) => x.id === valor);
      if (!cultura) return;
      const primeiraFase = Object.keys(cultura.fases)[0]!;
      banco.salvarLavoura(ctx.userId, { cultura: cultura.id, fase: banco.lavoura(ctx.userId)?.cultura === cultura.id ? banco.lavoura(ctx.userId)!.fase : primeiraFase });
      await ctx.editar(`🌾 ${cultura.nome}`);
      return perguntarFase(ctx, cultura);
    }
    if (campo === 'fase') {
      const lavoura = banco.lavoura(ctx.userId);
      const cultura = c.culturas().find((x) => x.id === lavoura?.cultura);
      if (!lavoura || !cultura?.fases[valor!]) return;
      banco.salvarLavoura(ctx.userId, { fase: valor });
      await ctx.editar(`📅 Fase: ${cultura.fases[valor!]!.nome}`);
      return ctx.responder({ texto: '💧 A lavoura é irrigada?', botoes: [[{ texto: 'Sim', dados: 'agro:irrigada:sim' }, { texto: 'Não', dados: 'agro:irrigada:nao' }]] });
    }
    if (campo === 'irrigada') {
      banco.salvarLavoura(ctx.userId, { irrigada: valor === 'sim' });
      const p = banco.preferencias(ctx.userId);
      await ctx.editar(`💧 Irrigada: ${valor === 'sim' ? 'sim' : 'não'}`);
      return ctx.responder(
        `✅ Pronto! Mando o boletim às ${p.horarios.map((h) => `${h}h`).join(' e ')} e aviso na hora se aparecer risco grave.\n` +
          'Mude quando quiser: /alertas (como e quando receber) · /lavoura · /clima (o tempo agora)',
      );
    }
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
      return ctx.editar('🗑️ Pronto: apaguei seu lugar, sua lavoura, suas preferências e as mensagens que mandei. Para voltar, /start.');
    }
    if (campo === 'esquecer') return ctx.editar('Ok, nada foi apagado.');
    if (campo === 'mudar' && valor === 'cultura') return perguntarCultura(ctx);
    if (campo === 'mudar' && valor === 'fase') {
      const cultura = c.culturas().find((x) => x.id === banco.lavoura(ctx.userId)?.cultura);
      return cultura ? perguntarFase(ctx, cultura) : perguntarCultura(ctx);
    }
  });

  k7.telegram.comando('clima', 'O tempo agora, nos próximos dias e o que fazer na lavoura', async (ctx) => {
    const lugar = banco.lugar(ctx.userId);
    if (!lugar) return ctx.responder({ texto: 'Primeiro me mande a localização da roça.', pedirLocalizacao: '📍 Enviar localização da roça' });
    const p = await c.meteo.previsao(lugar.celula);
    const lavoura = banco.lavoura(ctx.userId);
    const resultados = avaliarRegras(c.regras(), p, lavoura, c.culturas());
    const texto = mensagemClima(p, lugar, lavoura, c.culturas(), resultados);
    await ctx.responder(await comCartao(k7, texto, () => cartaoSvg(p, lugar, lavoura, c.culturas(), resultados, 'Tempo agora')));
    banco.registrarEnvio({ userId: ctx.userId, tipo: 'resposta', regras: resultados.map((r) => r.regra), severidade: null, texto, entregue: true, erro: null });
  });

  k7.telegram.comando('lavoura', 'Ver e mudar a cultura, a fase e a irrigação', async (ctx) => {
    const lavoura = banco.lavoura(ctx.userId);
    if (!lavoura) return perguntarCultura(ctx, '🌾 Você ainda não me disse o que planta. O que é?');
    const cultura = c.culturas().find((x) => x.id === lavoura.cultura);
    await ctx.responder({
      texto: `🌾 ${cultura?.nome ?? lavoura.cultura} · ${cultura?.fases[lavoura.fase]?.nome ?? lavoura.fase} · ${lavoura.irrigada ? 'irrigada' : 'sem irrigação'}`,
      botoes: [[{ texto: 'Mudar cultura', dados: 'agro:mudar:cultura' }, { texto: 'Mudar fase', dados: 'agro:mudar:fase' }], [{ texto: lavoura.irrigada ? 'Não é irrigada' : 'É irrigada', dados: `agro:irrigada:${lavoura.irrigada ? 'nao' : 'sim'}` }]],
    });
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
    await ctx.responder('💧 Anotado: a conta de água recomeça a partir de hoje.');
  });
  k7.telegram.comando('esquecer', 'Apagar meu lugar, minha lavoura e minhas mensagens', (ctx) =>
    ctx.responder({ texto: 'Apagar seu lugar, sua lavoura, suas preferências e as mensagens que mandei?', botoes: [[{ texto: '🗑️ Apagar', dados: 'agro:esquecer:sim' }, { texto: 'Cancelar', dados: 'agro:esquecer:nao' }]] }),
  );
}
