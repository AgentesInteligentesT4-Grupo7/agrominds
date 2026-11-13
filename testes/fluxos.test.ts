import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Banco } from '../extensao/Banco.js';
import type { TelegramResposta } from '../extensao/k7.js';
import { OpenMeteo, type Previsao } from '../extensao/OpenMeteo.js';
import { registrarTelegram } from '../extensao/telegram.js';
import { registrarFerramentas } from '../extensao/ferramentas.js';
import { calendarioDe, hojeLocal, nomesPedidos } from '../extensao/Servicos.js';
import { K7Falso, dadosDaPagina, montarFita, previsaoSintetica, quando } from './apoio.js';

const texto = (r: string | TelegramResposta) => (typeof r === 'string' ? r : r.texto);
const botoes = (r: string | TelegramResposta) => (typeof r === 'string' ? [] : (r.botoes ?? []).flat());

/** Fita com Telegram e ferramentas registrados. */
async function montar(previsao: () => Previsao, opcoes: Parameters<typeof montarFita>[1] = {}) {
  const m = await montarFita(previsao, opcoes);
  registrarTelegram(m.contexto);
  registrarFerramentas(m.contexto);
  return m;
}

describe('Conversa no Telegram', () => {
  it('localização → várias plantas (lavoura e horta) → quando plantou → irrigação → imagem "Minhas plantas"', async () => {
    const { k7, banco } = await montar(() => previsaoSintetica('2026-10-30T09:00'));
    const ana = k7.pessoa('50');
    await ana.comando('start');
    assert.equal((ana.respostas[0] as TelegramResposta).pedirLocalizacao, '📍 Estou no lugar: enviar localização');
    assert.match(texto(ana.respostas[0]!), /roça, sítio, horta ou vaso/);

    await ana.localizacao(-16.6869, -49.2648);
    assert.deepEqual([banco.lugar('50')!.lat, banco.lugar('50')!.nome, banco.lugar('50')!.uf], [-16.69, 'Goiânia/GO', 'GO'], 'guarda só 2 casas (~1 km)');
    assert.match(texto(ana.respostas.at(-1)!), /Recebi: Goiânia\/GO[\s\S]*quantas quiser/);
    assert.ok(botoes(ana.respostas.at(-1)!).some((b) => b.dados === 'agro:grupo:horta'));

    // Marca soja e milho na lavoura; alface e cebola na horta; desmarca o milho.
    await ana.toque('agro:grupo:lavoura');
    for (const p of ['soja', 'milho', 'milho']) await ana.toque(`agro:sel:${p}`);
    await ana.toque('agro:grupo:horta');
    for (const p of ['alface', 'cebola']) await ana.toque(`agro:sel:${p}`);
    assert.ok(botoes(ana.respostas.at(-1)!).some((b) => b.texto === '✅ Alface'));
    assert.deepEqual(banco.lavouras('50').map((l) => l.planta), ['soja', 'alface', 'cebola']);

    // Pronto: pergunta quando plantou a soja (lavoura); a horta entra sem perguntas.
    await ana.toque('agro:pronto');
    assert.match(texto(ana.respostas.at(-1)!), /Quando você plantou a soja\?/);
    await ana.toque('agro:plantou:soja:60');
    assert.equal(banco.lavoura('50', 'soja')!.plantio, (() => { const d = new Date(`${hojeLocal()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 60); return d.toISOString().slice(0, 10); })());
    assert.match(texto(ana.respostas.at(-1)!), /Alguma tem irrigação\?/);
    await ana.toque('agro:irr:cebola');
    await ana.toque('agro:irr-ok');
    assert.equal(banco.lavoura('50', 'cebola')!.irrigada, true);

    // Fim do cadastro: a imagem "Minhas plantas" (layout plantas) e o resumo dos comandos.
    const imagem = ana.respostas.at(-2) as TelegramResposta;
    assert.equal(imagem.imagem!.subarray(1, 4).toString(), 'PNG');
    const dados = dadosDaPagina(k7.htmls.at(-1)!);
    assert.deepEqual(dados.plantas.map((p: { nome: string }) => p.nome), ['Soja', 'Alface', 'Cebola']);
    assert.equal(dados.plantas[0].fase, 'Florindo', '60 de 120 dias: florescimento');
    assert.match(dados.plantas[0].janela, /Plantar de 11\/set a 10\/jan/);
    assert.match(dados.plantas[1].janela, /Sem zoneamento oficial/);
    assert.match(texto(ana.respostas.at(-1)!), /Pronto! Boletim às 6h e 18h/);
  });

  it('/clima vai como imagem do layout do tempo, com legenda curta; sem navegador, vai o texto', async () => {
    const { k7, banco } = await montar(() => previsaoSintetica('2026-10-30T09:00'));
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26);
    banco.salvarLavoura('50', 'soja', { cultura: 'soja', fase: 'florescimento', irrigada: true });
    const ana = k7.pessoa('50');
    await ana.comando('clima');
    const r = ana.respostas.at(-1) as TelegramResposta;
    assert.ok(r.imagem);
    assert.match(r.texto, /^🌱 Tempo agora · Goiânia\/GO/);
    assert.ok(r.texto.length < 300, 'a legenda é curta: os dados estão na imagem');
    const dados = dadosDaPagina(k7.htmls.at(-1)!);
    assert.deepEqual([dados.lugar, dados.agora.temperatura, dados.dias.length], ['Goiânia/GO', 24, 4]);
    assert.equal(banco.envios({ userId: '50' })[0]!.tipo, 'resposta');
    assert.match(banco.envios({ userId: '50' })[0]!.texto, /Agora: 24°C/, 'o histórico guarda o texto completo');

    k7.semNavegador = true;
    await ana.comando('clima');
    assert.match(texto(ana.respostas.at(-1)!), /Goiânia\/GO \(soja \(florindo, irrigada\)\)[\s\S]*Agora: 24°C/);
  });

  it('/previsao: botões de período; fim de semana com gráfico hora a hora; 14 dias, dia a dia', async () => {
    const { k7, banco } = await montar(() => previsaoSintetica('2026-10-30T09:00'));
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26);
    const ana = k7.pessoa('50');
    await ana.comando('previsao');
    assert.deepEqual(botoes(ana.respostas.at(-1)!).map((b) => b.dados), ['agro:prev:hoje', 'agro:prev:amanha', 'agro:prev:fds', 'agro:prev:3', 'agro:prev:7', 'agro:prev:14']);
    await ana.comando('previsao', '3 dias');
    const tres = dadosDaPagina(k7.htmls.at(-1)!);
    assert.equal(tres.titulo, 'Previsão · próximos 3 dias');
    assert.ok(tres.horas.length > 24, 'até 3 dias: hora a hora');
    await ana.toque('agro:prev:7');
    const sete = dadosDaPagina(k7.htmls.at(-1)!);
    assert.equal(sete.horas, null);
    assert.equal(sete.dias.length, 7);
  });

  it('/calendario e /plantar: janelas do ZARC no município; sem a tábua, explica', async () => {
    const { k7, banco } = await montar(() => previsaoSintetica('2026-10-30T09:00'));
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26);
    banco.salvarLavoura('50', 'soja', { cultura: 'soja' });
    const ana = k7.pessoa('50');
    await ana.comando('calendario');
    const cal = dadosDaPagina(k7.htmls.at(-1)!);
    assert.deepEqual(cal.linhas.map((l: { nome: string }) => l.nome), ['Soja']);
    assert.equal(cal.linhas[0].risco[25], 30, 'decêndio 26: menor risco entre os ciclos (40 e 30)');
    await ana.comando('plantar');
    const sug = dadosDaPagina(k7.htmls.at(-1)!);
    assert.equal(sug.titulo, 'O que plantar agora');
    assert.ok(sug.linhas.every((l: { semDado?: string }) => !l.semDado), 'só o que tem janela no município');

    const vazio = await montar(() => previsaoSintetica('2026-10-30T09:00'), { zarc: false });
    vazio.banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26);
    const beto = vazio.k7.pessoa('50');
    await beto.comando('calendario');
    assert.match(texto(beto.respostas.at(-1)!), /ainda não foi baixado/);
  });

  it('o que plantar agora: lista em ordem alfabética; o que a pessoa pede entra a mais na tabela', async () => {
    const { k7, banco, contexto } = await montar(() => previsaoSintetica('2026-10-30T09:00'));
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26);
    assert.deepEqual(nomesPedidos('e o feijão? Tomate e abóbora'), ['feijão', 'Tomate', 'abóbora']);
    await calendarioDe(contexto, '50', { todas: true, sugerir: true, incluir: nomesPedidos('feijão, tomate, abóbora, soja') }, quando('2026-10-30T09:00'));
    const d = dadosDaPagina(k7.htmls.at(-1)!);
    assert.deepEqual(d.destaque.agora, ['Banana', 'Soja'], 'em ordem alfabética (no catálogo, soja vem antes)');
    assert.deepEqual(
      d.linhas.map((l: { nome: string; epoca?: string; pedida?: boolean; semDado?: string }) => [l.nome, l.epoca ?? '', l.pedida ?? false, l.semDado ?? '']),
      [
        ['Banana', '', false, ''],
        ['Soja', '', false, ''],
        ['Feijão', '1ª safra', true, 'nao_indicado'],
        ['Feijão', '2ª safra', true, 'nao_indicado'],
        ['Tomate', '', true, 'sem_zoneamento'],
        ['Abóbora', '', true, 'fora_do_catalogo'],
      ],
      'soja já estava na lista: não repete',
    );
    const ana = k7.pessoa('50');
    await ana.comando('plantar', 'e o tomate?');
    assert.ok(dadosDaPagina(k7.htmls.at(-1)!).linhas.some((l: { nome: string; pedida?: boolean }) => l.nome === 'Tomate' && l.pedida));
  });

  it('/calendario com nomes mostra só essas plantas; Minhas plantas traz a água da semana', async () => {
    const { k7, banco } = await montar(() => previsaoSintetica('2026-10-30T09:00'));
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26);
    banco.salvarLavoura('50', 'soja', { cultura: 'soja', fase: 'florescimento' });
    const ana = k7.pessoa('50');
    await ana.comando('calendario', 'uva, banana');
    const cal = dadosDaPagina(k7.htmls.at(-1)!);
    assert.deepEqual([...new Set(cal.linhas.map((l: { nome: string }) => l.nome))], ['Uva', 'Banana'], 'só as pedidas, sem a soja da pessoa');
    assert.equal(cal.linhas.find((l: { nome: string }) => l.nome === 'Banana').tempo, 'perene');
    await ana.comando('plantas');
    const soja = dadosDaPagina(k7.htmls.at(-1)!).plantas[0];
    assert.match(soja.agua, /^💧 Nos próximos 7 dias deve usar ~\d+ mm de água \(\d+ L por m²\); chuva prevista: 0 mm\. Faltam ~\d+ mm que a chuva não cobre\.$/);
  });

  it('/alertas e /esquecer', async () => {
    const { k7, banco } = await montar(() => previsaoSintetica('2026-10-30T09:00'));
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26);
    banco.salvarLavoura('50', 'soja');
    const ana = k7.pessoa('50');
    await ana.toque('agro:modo:alertas');
    await ana.toque('agro:horas:6-12-18');
    assert.deepEqual(banco.preferencias('50'), { userId: '50', modo: 'alertas', horarios: [6, 12, 18], pausado: false, audio: false });
    await ana.toque('agro:esquecer:sim');
    assert.equal(banco.lugar('50'), undefined);
    assert.deepEqual(banco.lavouras('50'), []);
  });

  it('ferramentas do agente: números do tempo e do ZARC, com a imagem anexada; sem lugar, pede a localização', async () => {
    const { k7, banco } = await montar(() => previsaoSintetica('2026-10-30T09:00'));
    const ctx = k7.ctxFerramenta('77');
    await assert.rejects(k7.ferramentas.get('clima_lavoura')!.run({}, ctx), (e: { userMessage?: string }) => /localização/.test(e.userMessage ?? ''));
    banco.salvarLugar('77', 'Goiânia/GO', -16.69, -49.26);
    assert.match(await k7.ferramentas.get('previsao_periodo')!.run({ periodo: 'fds' }, ctx), /Previsão do fim de semana · Goiânia\/GO[\s\S]*imagem com estes dados/);
    assert.equal(k7.anexadas.length, 1);
    assert.match(await k7.ferramentas.get('definir_planta')!.run({ planta: 'feijao', plantio: '2026-10-01', irrigada: true }, ctx), /Feijão registrada em Goiânia\/GO, plantio 2026-10-01, irrigada/);
    assert.match(await k7.ferramentas.get('epoca_de_plantio')!.run({ plantas: ['soja', 'alface'] }, ctx), /Soja: plantar de 11\/set a 10\/jan \(risco até 30%\)[\s\S]*Alface: o ZARC não tem zoneamento/);
    assert.match(await k7.ferramentas.get('balanco_agua')!.run({}, ctx), /Feijão: fase .* déficit [\d.]+ mm/);
    assert.match(await k7.ferramentas.get('definir_planta')!.run({ planta: 'feijao', remover: true }, ctx), /removida/);
  });
});

describe('Notificações automáticas', () => {
  const geada = () => previsaoSintetica('2026-10-30T09:00', (hora, h) => (hora.startsWith('2026-10-31') && h === 5 ? { temperature_2m: 0.5 } : {}));

  it('boletim no horário (uma vez só, em imagem) e alerta grave fora dele; o que foi no boletim não repete', async () => {
    const { k7, banco, contexto } = await montar(geada);
    const notificador = contexto.notificador;
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26);
    banco.salvarLavoura('50', 'soja', { cultura: 'soja', fase: 'inicial' });

    // 6h: boletim (com a geada dentro) e, por ser o 1º boletim do mês, a sugestão do que plantar.
    await notificador.ciclo(quando('2026-10-30T06:10'));
    assert.equal(k7.enviados.length, 2);
    const boletim = k7.enviados[0]!.mensagem as TelegramResposta;
    assert.match(boletim.texto, /^🌅 Boletim das 6h · Goiânia\/GO\n🔴 Risco de geada/);
    assert.equal(boletim.imagem!.subarray(1, 4).toString(), 'PNG');
    assert.match((k7.enviados[1]!.mensagem as TelegramResposta).texto, /O que plantar agora/);
    await notificador.ciclo(quando('2026-10-30T06:40'));
    assert.equal(k7.enviados.length, 2, 'mesmo horário: não manda de novo');
    await notificador.ciclo(quando('2026-10-30T09:00'));
    assert.equal(k7.enviados.length, 2, 'a geada já foi no boletim');
    const envio = banco.envios({ userId: '50', tipo: 'boletim' }).at(-1)!;
    assert.deepEqual([envio.severidade, envio.entregue], ['grave', true]);
    assert.match(envio.texto, /Boletim das 6h — Goiânia\/GO \(soja/);

    // Outra pessoa, sem boletim no horário: o alerta grave vai na hora, mesmo de madrugada (layout alerta).
    banco.salvarLugar('60', 'Jataí/GO', -17.88, -51.72);
    banco.salvarPreferencias('60', { horarios: [18] });
    await notificador.ciclo(quando('2026-10-30T23:00'));
    const alerta = k7.enviados.find((e) => e.userId === '60')!;
    assert.match(texto(alerta.mensagem), /^⚠️ Aviso para Jataí\/GO\n🔴 Risco de geada/);
    assert.equal(dadosDaPagina(k7.htmls.at(-1)!).avisos[0].severidade, 'grave');
  });

  it('várias plantas: o aviso geral sai uma vez, com a severidade mais alta entre elas', async () => {
    const { k7, banco, contexto } = await montar(geada);
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26);
    banco.salvarPreferencias('50', { modo: 'alertas' });
    banco.salvarLavoura('50', 'soja', { cultura: 'soja', fase: 'vegetativo' });
    banco.salvarLavoura('50', 'alface', { cultura: 'hortalicas', fase: 'vegetativo' });
    await contexto.notificador.ciclo(quando('2026-10-30T10:00'));
    const avisos = dadosDaPagina(k7.htmls.at(-1)!).avisos as Array<{ titulo: string }>;
    assert.equal(avisos.filter((a) => a.titulo === 'Risco de geada').length, 1);
  });

  it('modo boletim não manda alerta de atenção fora de hora; modo alertas manda; silêncio de madrugada', async () => {
    const chuva = () => previsaoSintetica('2026-10-30T09:00', (hora, h) => (hora.startsWith('2026-10-30') && h === 16 ? { precipitation: 25 } : {}));
    const { k7, banco, contexto } = await montar(chuva);
    banco.salvarLugar('1', 'A', -16.69, -49.26);
    banco.salvarLugar('2', 'B', -16.69, -49.26);
    banco.salvarPreferencias('2', { modo: 'alertas' });
    await contexto.notificador.ciclo(quando('2026-10-30T10:00'));
    assert.deepEqual(k7.enviados.map((e) => e.userId), ['2'], 'atenção: só quem escolheu "só alertas"');
    k7.enviados.length = 0;
    banco.salvarLugar('3', 'C', -16.69, -49.26);
    banco.salvarPreferencias('3', { modo: 'alertas' });
    await contexto.notificador.ciclo(quando('2026-10-30T23:30'));
    assert.equal(k7.enviados.length, 0, 'de madrugada, só alerta grave');
  });

  it('pausado, só quando pedir, bloqueado e quem bloqueou o bot', async () => {
    const { k7, banco, contexto } = await montar(geada);
    for (const id of ['1', '2', '3', '4']) banco.salvarLugar(id, id, -16.69, -49.26);
    banco.salvarPreferencias('1', { pausado: true });
    banco.salvarPreferencias('2', { modo: 'pedir' });
    k7.acessos = [{ userId: 3, nome: 'X', username: null, status: 'bloqueado', origem: 'pedido', criadoEm: '', ultimoContato: null }];
    k7.inalcancaveis.add('4');
    await contexto.notificador.ciclo(quando('2026-10-30T10:00'));
    assert.equal(k7.enviados.length, 0);
    const falhou = banco.envios({ userId: '4' })[0]!;
    assert.deepEqual([falhou.entregue, falhou.erro], [false, 'Forbidden: bot was blocked by the user']);
    // Bloqueou o bot: não insiste a cada 10 min (o registro não enche de tentativas).
    await contexto.notificador.ciclo(quando('2026-10-30T10:10'));
    assert.equal(banco.envios({ userId: '4' }).length, 1);
  });
});

describe('Open-Meteo: cache, histórico e falha', () => {
  let chamadas = 0;
  let falhar = false;
  const resposta = previsaoSintetica('2026-10-30T09:00');
  const server = http.createServer((req, res) => {
    chamadas++;
    if (falhar) return void res.writeHead(503).end('fora do ar');
    assert.match(req.url!, /latitude=-16\.7&longitude=-49\.3&timezone=auto&forecast_days=16/);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ timezone: resposta.timezone, utc_offset_seconds: -10800, current: resposta.atual, hourly: resposta.horas, daily: resposta.dias }));
  });
  let url = '';
  before(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/forecast`;
  });
  after(() => server.close());

  it('uma consulta por célula por hora; grava o ocorrido e a previsão de 24 h antes; sem resposta, usa a guardada', async () => {
    const k7 = new K7Falso();
    const sql = k7.api().sql;
    new Banco(sql);
    let agora = quando('2026-10-30T09:00');
    const meteo = new OpenMeteo(sql, url, () => agora);
    await meteo.previsao('-16.7,-49.3');
    await meteo.previsao('-16.7,-49.3');
    assert.equal(chamadas, 1, 'cache de 1 h');
    assert.ok(sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM historico')!.n >= 7 * 24, 'horas passadas viram histórico');
    assert.deepEqual(sql.all<{ hora: string }>('SELECT hora FROM previsto ORDER BY hora').map((r) => r.hora), ['2026-10-31T08:00', '2026-10-31T09:00', '2026-10-31T10:00']);

    agora = quando('2026-10-30T10:30');
    falhar = true;
    const velha = await meteo.previsao('-16.7,-49.3');
    assert.equal(velha.desatualizada, true);
    agora = quando('2026-10-30T17:00');
    await assert.rejects(meteo.previsao('-16.7,-49.3'), (e: { userMessage?: string }) => /Open-Meteo fora do ar/.test(e.userMessage ?? ''));
  });
});
