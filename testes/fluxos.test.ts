import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Banco } from '../extensao/Banco.js';
import type { TelegramResposta } from '../extensao/k7.js';
import { Notificador } from '../extensao/Notificador.js';
import { OpenMeteo, type Previsao } from '../extensao/OpenMeteo.js';
import { lerCulturas, lerRegras } from '../extensao/Regras.js';
import { registrarTelegram } from '../extensao/telegram.js';
import { registrarFerramentas } from '../extensao/ferramentas.js';
import { K7Falso, lerYaml, previsaoSintetica, quando } from './apoio.js';

const dir = path.resolve('regras');
const regras = () => lerRegras(lerYaml(fs.readFileSync(path.join(dir, 'clima.yaml'), 'utf8')));
const culturas = () => lerCulturas(lerYaml(fs.readFileSync(path.join(dir, 'culturas.yaml'), 'utf8')));
const texto = (r: string | TelegramResposta) => (typeof r === 'string' ? r : r.texto);

/** Montagem com uma previsão fixa no lugar do Open-Meteo. */
function montar(previsao: () => Previsao) {
  const k7 = new K7Falso();
  const api = k7.api();
  const banco = new Banco(api.sql);
  const meteo = { previsao: async () => previsao() } as unknown as OpenMeteo;
  const notificador = new Notificador(api, banco, meteo, regras, culturas);
  const contexto = { k7: api, banco, meteo, notificador, regras, culturas, nomeDoLugar: async () => 'Goiânia/GO' };
  registrarTelegram(contexto);
  registrarFerramentas(contexto);
  return { k7, banco, notificador };
}

describe('Conversa no Telegram', () => {
  it('localização → cultura → fase → irrigada; /clima; /alertas; /esquecer', async () => {
    const { k7, banco } = montar(() => previsaoSintetica('2026-10-30T09:00'));
    const ana = k7.pessoa('50');
    await ana.comando('start');
    assert.equal((ana.respostas[0] as TelegramResposta).pedirLocalizacao, '📍 Enviar localização da roça');

    await ana.localizacao(-16.6869, -49.2648);
    assert.deepEqual([banco.lugar('50')!.lat, banco.lugar('50')!.lon, banco.lugar('50')!.nome], [-16.69, -49.26, 'Goiânia/GO'], 'guarda só 2 casas (~1 km)');
    const perguntaCultura = ana.respostas.at(-1) as TelegramResposta;
    assert.match(perguntaCultura.texto, /Recebi: Goiânia\/GO/);
    assert.ok(perguntaCultura.botoes!.flat().some((b) => b.dados === 'agro:cultura:milho'));

    await ana.toque('agro:cultura:milho');
    const fases = ana.respostas.at(-1) as TelegramResposta;
    assert.ok(fases.botoes!.flat().some((b) => b.texto === 'Pendoando / florindo'));
    await ana.toque('agro:fase:florescimento');
    await ana.toque('agro:irrigada:sim');
    assert.match(texto(ana.respostas.at(-1)!), /Pronto! Mando o boletim às 6h e 18h/);
    assert.deepEqual([banco.lavoura('50')!.cultura, banco.lavoura('50')!.fase, banco.lavoura('50')!.irrigada], ['milho', 'florescimento', true]);

    await ana.comando('clima');
    assert.match(texto(ana.respostas.at(-1)!), /Goiânia\/GO \(milho, pendoando \/ florindo, irrigada\)[\s\S]*Agora: 24°C[\s\S]*Dados: Open-Meteo\.com/);
    assert.equal(banco.envios({ userId: '50' })[0]!.tipo, 'resposta');

    await ana.toque('agro:modo:alertas');
    await ana.toque('agro:horas:6-12-18');
    assert.deepEqual(banco.preferencias('50'), { userId: '50', modo: 'alertas', horarios: [6, 12, 18], pausado: false });

    await ana.toque('agro:esquecer:sim');
    assert.equal(banco.lugar('50'), undefined);
    assert.equal(banco.lavoura('50'), undefined);
    assert.deepEqual(banco.envios({ userId: '50' }), []);
  });

  it('ferramentas do agente: números da previsão; sem lugar, pede a localização', async () => {
    const { k7, banco } = montar(() => previsaoSintetica('2026-10-30T09:00'));
    await assert.rejects(k7.ferramentas.get('clima_lavoura')!.run({}, { userId: '77' }), (e: { userMessage?: string }) => /localização/.test(e.userMessage ?? ''));
    banco.salvarLugar('77', 'Rio Verde/GO', -17.8, -50.9);
    assert.match(await k7.ferramentas.get('previsao_dias')!.run({ dias: 2 }, { userId: '77' }), /Previsão para Rio Verde\/GO[\s\S]*Hoje:/);
    assert.match(await k7.ferramentas.get('definir_lavoura')!.run({ cultura: 'soja', fase: 'inicial' }, { userId: '77' }), /soja, fase inicial/);
    assert.match(await k7.ferramentas.get('balanco_agua')!.run({}, { userId: '77' }), /Déficit acumulado: [\d.]+ mm/);
  });
});

describe('Notificações automáticas', () => {
  const geada = () => previsaoSintetica('2026-10-30T09:00', (hora, h) => (hora.startsWith('2026-10-31') && h === 5 ? { temperature_2m: 0.5 } : {}));

  it('boletim no horário (uma vez só) e alerta grave fora dele; o que foi no boletim não repete', async () => {
    const { k7, banco, notificador } = montar(geada);
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26);
    banco.salvarLavoura('50', { cultura: 'soja', fase: 'inicial' });

    // 6h: boletim (com a geada dentro).
    await notificador.ciclo(quando('2026-10-30T06:10'));
    assert.equal(k7.enviados.length, 1);
    assert.match(texto(k7.enviados[0]!.mensagem), /^🌅 Boletim das 6h — Goiânia\/GO \(soja, plantada \/ emergência\)[\s\S]*Risco de geada/);
    await notificador.ciclo(quando('2026-10-30T06:40'));
    assert.equal(k7.enviados.length, 1, 'mesmo horário: não manda de novo');
    await notificador.ciclo(quando('2026-10-30T09:00'));
    assert.equal(k7.enviados.length, 1, 'a geada já foi no boletim');
    const [envio] = banco.envios({ userId: '50' });
    assert.deepEqual([envio!.tipo, envio!.severidade, envio!.entregue], ['boletim', 'grave', true]);

    // Outra pessoa, sem boletim no horário: o alerta grave vai na hora, mesmo de madrugada.
    banco.salvarLugar('60', 'Jataí/GO', -17.88, -51.72);
    banco.salvarPreferencias('60', { horarios: [18] });
    await notificador.ciclo(quando('2026-10-30T23:00'));
    const alerta = k7.enviados.find((e) => e.userId === '60')!;
    assert.match(texto(alerta.mensagem), /^⚠️ Aviso para Jataí\/GO[\s\S]*Risco de geada/);
  });

  it('modo boletim não manda alerta de atenção fora de hora; modo alertas manda; silêncio de madrugada', async () => {
    const chuva = () => previsaoSintetica('2026-10-30T09:00', (hora, h) => (hora.startsWith('2026-10-30') && h === 16 ? { precipitation: 25 } : {}));
    const { k7, banco, notificador } = montar(chuva);
    banco.salvarLugar('1', 'A', -16.69, -49.26);
    banco.salvarLugar('2', 'B', -16.69, -49.26);
    banco.salvarPreferencias('2', { modo: 'alertas' });
    await notificador.ciclo(quando('2026-10-30T10:00'));
    assert.deepEqual(k7.enviados.map((e) => e.userId), ['2'], 'atenção: só quem escolheu "só alertas"');
    k7.enviados.length = 0;
    banco.salvarLugar('3', 'C', -16.69, -49.26);
    banco.salvarPreferencias('3', { modo: 'alertas' });
    await notificador.ciclo(quando('2026-10-30T23:30'));
    assert.equal(k7.enviados.length, 0, 'de madrugada, só alerta grave');
  });

  it('pausado, só quando pedir, bloqueado e quem bloqueou o bot', async () => {
    const { k7, banco, notificador } = montar(geada);
    for (const id of ['1', '2', '3', '4']) banco.salvarLugar(id, id, -16.69, -49.26);
    banco.salvarPreferencias('1', { pausado: true });
    banco.salvarPreferencias('2', { modo: 'pedir' });
    k7.acessos = [{ userId: 3, nome: 'X', username: null, status: 'bloqueado', origem: 'pedido', criadoEm: '', ultimoContato: null }];
    k7.inalcancaveis.add('4');
    await notificador.ciclo(quando('2026-10-30T10:00'));
    assert.equal(k7.enviados.length, 0);
    const falhou = banco.envios({ userId: '4' })[0]!;
    assert.deepEqual([falhou.entregue, falhou.erro], [false, 'Forbidden: bot was blocked by the user']);
    // Bloqueou o bot: não insiste a cada 10 min (o registro não enche de tentativas).
    await notificador.ciclo(quando('2026-10-30T10:10'));
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
    assert.match(req.url!, /latitude=-16\.7&longitude=-49\.3&timezone=auto/);
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
