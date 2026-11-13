import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diaDe, paraFala } from '../extensao/Caderno.js';
import { registrarFerramentas } from '../extensao/ferramentas.js';
import type { TelegramResposta } from '../extensao/k7.js';
import { horasDePulverizar, textoPulverizacao } from '../extensao/Pulverizacao.js';
import type { Radar, RadarDoLugar } from '../extensao/Radar.js';
import { balancoHidrico } from '../extensao/Regras.js';
import { registrarTelegram } from '../extensao/telegram.js';
import { montarFita, previsaoSintetica, quando, regrasDaFita } from './apoio.js';

const texto = (m: string | TelegramResposta) => (typeof m === 'string' ? m : m.texto);

async function montar(opcoes: Parameters<typeof montarFita>[1] = {}, previsao = () => previsaoSintetica('2026-10-30T09:00')) {
  const m = await montarFita(previsao, opcoes);
  registrarTelegram(m.contexto);
  registrarFerramentas(m.contexto);
  await m.k7.pessoa('60').localizacao(-16.69, -49.26);
  return m;
}

describe('Melhor hora para pulverizar', () => {
  // Hoje: vento forte das 11h às 14h e chuva às 17h; amanhã, vento forte o dia todo.
  const p = previsaoSintetica('2026-10-30T06:00', (hora, h) => ({
    ...(hora.startsWith('2026-10-30') && h >= 11 && h <= 14 ? { wind_speed_10m: 14 } : {}),
    ...(hora === '2026-10-30T17:00' ? { precipitation: 2 } : {}),
    ...(hora.startsWith('2026-10-31') ? { wind_speed_10m: 18 } : {}),
  }));
  const regra = regrasDaFita().find((r) => r.id === 'pulverizacao')!;

  it('hora a hora com o motivo das horas ruins, a próxima janela boa e o critério da regra', () => {
    const agora = quando('2026-10-30T06:00');
    const horas = horasDePulverizar(p, regra, agora, 2);
    assert.ok(horas.every((h) => Number(h.hora.slice(11, 13)) >= 6 && Number(h.hora.slice(11, 13)) <= 18), 'só horas de dia');
    const t = textoPulverizacao(horas, regra, 'Sítio', p, agora, 2);
    assert.match(t, /• Hoje: boas horas das 6h às 11h e às 18h\./);
    assert.match(t, /vento forte \(até 14 km\/h\): deriva das 11h às 15h/);
    assert.match(t, /chuva logo depois \(até 2 mm em 2 h\)/);
    assert.match(t, /• Amanhã: nenhuma hora boa — vento forte \(até 18 km\/h\)/);
    assert.match(t, /Próxima janela boa: hoje das 6h às 11h/);
    assert.match(t, /Critério \(regras da fita\): vento 3–10 km\/h/);
    assert.match(t, /Produto e dose, só com receituário/);
  });

  it('ferramenta: usa a regra do YAML e o lugar da pessoa', async () => {
    const { k7 } = await montar({}, () => p);
    const t = await k7.ferramentas.get('melhor_hora_pulverizar')!.run({ dias: 1 }, k7.ctxFerramenta('60'));
    assert.match(t, /🧴 Melhor hora para pulverizar · Goiânia\/GO · hoje/);
  });
});

describe('Pluviômetro e caderno de campo', () => {
  it('a chuva medida vale no lugar da estimativa do modelo no balanço de água', () => {
    const p = previsaoSintetica('2026-10-30T09:00');
    const agora = quando('2026-10-30T09:00');
    const modelo = balancoHidrico(p, 1, 7, 2, null, agora);
    const medido = balancoHidrico(p, 1, 7, 2, null, agora, { '2026-10-29': 30 });
    assert.equal(modelo.medidos, 0);
    assert.equal(medido.medidos, 1);
    assert.ok(medido.deficit < modelo.deficit, `${medido.deficit} < ${modelo.deficit}`);
    assert.equal(medido.serie.find((d) => d.dia === '2026-10-29')!.chuva, 30);
  });

  it('/choveu e registrar_chuva gravam a medida; balanco_agua e as regras passam a usá-la', async () => {
    const { k7, banco } = await montar();
    banco.salvarLavoura('60', 'milho', { cultura: 'milho', irrigada: true });
    const ana = k7.pessoa('60');
    await ana.comando('choveu', '12,5 ontem');
    assert.match(texto(ana.respostas.at(-1)!), /12,5 mm em \d{2}\/\d{2}/);
    await ana.comando('choveu', 'muito');
    assert.match(texto(ana.respostas.at(-1)!), /quantos milímetros/);
    const lugar = banco.lugar('60')!;
    assert.equal(Object.values(banco.chuvaMedida(lugar.id))[0], 12.5);
    assert.match(await k7.ferramentas.get('registrar_chuva')!.run({ mm: 8, dia: 'anteontem' }, k7.ctxFerramenta('60')), /8 mm .* anotados/);
    await assert.rejects(k7.ferramentas.get('registrar_chuva')!.run({ mm: 5, dia: '2099-01-01' }, k7.ctxFerramenta('60')), (e: { userMessage?: string }) => /Não entendi o dia/.test(e.userMessage ?? ''));
    assert.match(await k7.ferramentas.get('balanco_agua')!.run({}, k7.ctxFerramenta('60')), /pluviômetro/);
    assert.equal(banco.caderno('60', { tipo: 'chuva' }).length, 2, 'as medidas também ficam no caderno');
  });

  it('anotar_caderno e ver_caderno: colheita somada; irrigação zera a conta de água; /caderno lista', async () => {
    const { k7, banco } = await montar();
    banco.salvarLavoura('60', 'milho', { cultura: 'milho', irrigada: true });
    const anotar = k7.ferramentas.get('anotar_caderno')!;
    const ctx = k7.ctxFerramenta('60');
    assert.match(await anotar.run({ texto: 'colhi tomate', tipo: 'colheita', planta: 'tomate', quantidade: 40, unidade: 'caixas' }, ctx), /anotado no caderno/);
    await anotar.run({ texto: 'mais tomate', tipo: 'colheita', planta: 'tomate', quantidade: 12, unidade: 'caixas', dia: 'ontem' }, ctx);
    assert.equal(banco.lavoura('60', 'milho')!.irrigouEm, null);
    assert.match(await anotar.run({ texto: 'irriguei o milho', tipo: 'irrigacao', planta: 'milho' }, ctx), /conta de água das plantas irrigadas recomeçou/);
    assert.notEqual(banco.lavoura('60', 'milho')!.irrigouEm, null);
    const lista = await k7.ferramentas.get('ver_caderno')!.run({}, ctx);
    assert.match(lista, /3 anotações/);
    assert.match(lista, /Colhido no período: Tomate 52 caixas/);
    assert.match(await k7.ferramentas.get('ver_caderno')!.run({ tipo: 'irrigacao' }, ctx), /1 anotação\)/);
    const ana = k7.pessoa('60');
    await ana.comando('caderno');
    assert.match(texto(ana.respostas.at(-1)!), /📒 Caderno de campo/);
  });

  it('dias ditos na conversa', () => {
    assert.equal(diaDe('ontem', '2026-01-05'), '2026-01-04');
    assert.equal(diaDe('28/12', '2026-01-05'), '2025-12-28', 'dezembro dito em janeiro é do ano passado');
    assert.equal(diaDe('2026-01-03', '2026-01-05'), '2026-01-03');
    assert.equal(diaDe('amanhã', '2026-01-05'), undefined);
    assert.equal(diaDe('2026-02-01', '2026-01-05'), undefined, 'futuro');
  });
});

describe('Aviso de chuva chegando pelo radar', () => {
  const radarCom = (dbz: number, minutos = 40, noLugar = 0): Radar =>
    ({
      doLugar: async (): Promise<RadarDoLugar> => ({
        imagemEm: quando('2026-10-30T10:25'),
        cobertura: 1,
        cobreLugar: true,
        leitura: { noLugar, maisPerto: { km: 30, rumo: 'oeste', dbz }, anda: { kmh: 40, rumo: 'leste' }, chega: { minutos, dbz } },
      }),
    }) as unknown as Radar;
  const avisos = (k7: { enviados: Array<{ mensagem: string | TelegramResposta }> }) => k7.enviados.map((e) => texto(e.mensagem)).filter((t) => /chegando/.test(t));

  it('chuva forte chegando vai mesmo no modo boletim, uma vez só no período', async () => {
    const { k7, contexto } = await montar({ radar: radarCom(45) });
    await contexto.notificador.ciclo(quando('2026-10-30T10:30'));
    const [aviso, ...resto] = avisos(k7);
    assert.equal(resto.length, 0);
    assert.match(aviso!, /Chuva forte chegando: pelo radar, deve começar por volta das 11h05 \(em ~40 min\), vindo do oeste/);
    assert.match(aviso!, /Goiânia\/GO/);
    await contexto.notificador.ciclo(quando('2026-10-30T10:40'));
    assert.equal(avisos(k7).length, 1, 'não repete');
  });

  it('chuva moderada só no modo "hora"; longe demais, já chovendo ou de madrugada (não grave): nada', async () => {
    const moderada = await montar({ radar: radarCom(33) });
    await moderada.contexto.notificador.ciclo(quando('2026-10-30T10:30'));
    assert.equal(avisos(moderada.k7).length, 0, 'modo boletim: só os graves');
    moderada.banco.salvarPreferencias('60', { modo: 'hora' });
    await moderada.contexto.notificador.ciclo(quando('2026-10-30T10:30'));
    assert.match(avisos(moderada.k7)[0]!, /Chuva moderada chegando/);
    await moderada.contexto.notificador.ciclo(quando('2026-10-30T23:30'));
    assert.equal(avisos(moderada.k7).length, 1, 'madrugada: só grave');

    for (const radar of [radarCom(45, 120), radarCom(45, 40, 35)]) {
      const m = await montar({ radar });
      await m.contexto.notificador.ciclo(quando('2026-10-30T10:30'));
      assert.equal(avisos(m.k7).length, 0);
    }
  });
});

describe('Boletim em áudio', () => {
  it('/audio liga; o boletim vai com a mensagem de voz (texto falado sem emoji e com as unidades por extenso)', async () => {
    const { k7, banco, contexto } = await montar();
    const ana = k7.pessoa('60');
    await ana.comando('audio');
    assert.equal(banco.preferencias('60').audio, true);
    assert.match(texto(ana.respostas.at(-1)!), /também em áudio/);
    await contexto.notificador.boletimAgora('60', 'boletim');
    const ultima = k7.enviados.at(-1)!.mensagem as TelegramResposta;
    assert.equal(ultima.audio?.formato, 'ogg');
    assert.ok(k7.falados.length === 1 && !/\p{Extended_Pictographic}/u.test(k7.falados[0]!), k7.falados[0]);

    k7.semVoz = true;
    await contexto.notificador.boletimAgora('60', 'boletim');
    assert.equal((k7.enviados.at(-1)!.mensagem as TelegramResposta).audio, undefined, 'sem voz, vai sem áudio');

    await ana.comando('audio');
    assert.equal(banco.preferencias('60').audio, false);
    assert.match(await k7.ferramentas.get('avisos_automaticos')!.run({ acao: 'ver', audio: true }, k7.ctxFerramenta('60')), /também em áudio/);
  });

  it('texto para fala', () => {
    assert.equal(
      paraFala('🌧️ Chuva forte: 12 mm às 15h, 28 °C · 60%\n• vento 14 km/h (regra em revisão)'),
      'Chuva forte: 12 milímetros às 15 horas, 28 graus, 60 por cento, vento 14 quilômetros por hora',
    );
  });
});

describe('ZARC: seu plantio na janela, risco e seguro', () => {
  it('diz se o plantio informado ficou dentro ou fora da janela e explica o risco e o Proagro', async () => {
    const { k7, banco } = await montar();
    banco.salvarLavoura('60', 'soja', { cultura: 'soja', plantio: '2026-10-25' });
    const epoca = k7.ferramentas.get('epoca_de_plantio')!;
    const dentro = await epoca.run({ plantas: ['soja'] }, k7.ctxFerramenta('60'));
    assert.match(dentro, /seu plantio de 25\/10 ficou dentro da janela \(risco \d0%\)/);
    assert.match(dentro, /cerca de 2 anos ruins em cada 10/);
    assert.match(dentro, /Proagro e o seguro rural com subvenção/);
    banco.salvarLavoura('60', 'soja', { plantio: '2026-03-15' });
    assert.match(await epoca.run({ plantas: ['soja'] }, k7.ctxFerramenta('60')), /seu plantio de 15\/03 ficou FORA da janela/);
  });
});
