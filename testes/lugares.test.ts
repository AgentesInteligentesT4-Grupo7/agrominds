import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Banco } from '../extensao/Banco.js';
import { registrarFerramentas } from '../extensao/ferramentas.js';
import type { TelegramResposta } from '../extensao/k7.js';
import { registrarTelegram } from '../extensao/telegram.js';
import { registrarWeb } from '../extensao/web.js';
import { dadosDaPagina, montarFita, previsaoSintetica, quando, sqlEmMemoria } from './apoio.js';

const texto = (r: string | TelegramResposta) => (typeof r === 'string' ? r : r.texto);
const botoes = (r: string | TelegramResposta) => (typeof r === 'string' ? [] : (r.botoes ?? []).flat());

async function montar() {
  const m = await montarFita(() => previsaoSintetica('2026-10-30T09:00'));
  registrarTelegram(m.contexto);
  registrarFerramentas(m.contexto);
  registrarWeb(m.contexto);
  return m;
}

describe('Vários lugares por pessoa', () => {
  it('banco antigo (um lugar por pessoa, plantas sem lugar) vira o novo sem perder nada', () => {
    const sql = sqlEmMemoria();
    sql.exec(`CREATE TABLE lugares (user_id TEXT PRIMARY KEY, nome TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, celula TEXT NOT NULL, uf TEXT, atualizado_em TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE lavouras (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, planta TEXT NOT NULL, cultura TEXT NOT NULL, fase TEXT NOT NULL, irrigada INTEGER NOT NULL DEFAULT 0, irrigou_em TEXT, plantio TEXT, pendente INTEGER NOT NULL DEFAULT 0, atualizado_em TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (user_id, planta));
      INSERT INTO lugares (user_id, nome, lat, lon, celula, uf) VALUES ('50', 'Goiânia/GO', -16.69, -49.26, '-16.7,-49.3', 'GO');
      INSERT INTO lavouras (user_id, planta, cultura, fase, plantio) VALUES ('50', 'soja', 'soja', 'vegetativo', '2026-10-01');`);
    const banco = new Banco(sql);
    const lugar = banco.lugar('50')!;
    assert.deepEqual([lugar.nome, lugar.cidade, lugar.apelido, lugar.atual], ['Goiânia/GO', 'Goiânia/GO', null, true]);
    assert.deepEqual(banco.lavouras('50').map((l) => [l.planta, l.plantio, l.lugarId]), [['soja', '2026-10-01', lugar.id]]);
  });

  it('cada lugar tem as plantas dele; o atual muda; remover leva as plantas junto', () => {
    const banco = new Banco(sqlEmMemoria());
    const casa = banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26, 'GO', { apelido: 'Casa' });
    banco.salvarLavoura('50', 'alface', { cultura: 'hortalicas' });
    const sitio = banco.salvarLugar('50', 'Rio Verde/GO', -17.79, -50.92, 'GO', { apelido: 'Sítio Boa Vista' });
    banco.salvarLavoura('50', 'soja', { cultura: 'soja' });
    assert.equal(banco.lugar('50')!.nome, 'Sítio Boa Vista (Rio Verde/GO)', 'o último cadastrado vira o atual');
    assert.deepEqual(banco.lavouras('50').map((l) => l.planta), ['soja']);
    assert.deepEqual(banco.lavouras('50', casa.id).map((l) => l.planta), ['alface']);
    banco.usarLugar('50', casa.id);
    assert.equal(banco.lugar('50')!.id, casa.id);
    // Mover o sítio (mesmo lugar, outra coordenada) mantém as plantas e o nome.
    banco.salvarLugar('50', 'Jataí/GO', -17.88, -51.72, 'GO', { id: sitio.id });
    assert.deepEqual([banco.lugar('50')!.nome, banco.lavouras('50').map((l) => l.planta)], ['Sítio Boa Vista (Jataí/GO)', ['soja']]);
    banco.removerLugar('50', sitio.id);
    assert.deepEqual([banco.lugaresDe('50').map((l) => l.apelido), banco.lugar('50')!.id], [['Casa'], casa.id]);
    assert.equal(banco.lavoura('50', 'soja', sitio.id), undefined);
  });

  it('Telegram: 2ª localização pergunta se é lugar novo ou a nova posição; /lugares usa e remove; /renomear', async () => {
    const { k7, banco } = await montar();
    const ana = k7.pessoa('50');
    await ana.localizacao(-16.69, -49.26);
    assert.match(texto(ana.respostas.at(-1)!), /Recebi: Goiânia\/GO\. Para dar um nome/);
    await ana.comando('renomear', 'Casa');
    assert.match(texto(ana.respostas.at(-1)!), /Pronto: Casa \(Goiânia\/GO\)/);

    await ana.localizacao(-17.79, -50.92);
    assert.deepEqual(botoes(ana.respostas.at(-1)!).map((b) => b.dados.split(':').slice(0, 3).join(':')), ['agro:loc:novo', 'agro:loc:mover']);
    await ana.toque('agro:loc:novo');
    assert.match(texto(ana.respostas.at(-1)!), /Novo lugar: Goiânia\/GO[\s\S]*O que você planta \(ou quer plantar\) aí\?/);
    assert.equal(banco.lugaresDe('50').length, 2);

    await ana.comando('lugares');
    const menu = ana.respostas.at(-1)!;
    assert.match(texto(menu), /○ Casa \(Goiânia\/GO\)[\s\S]*● Goiânia\/GO/);
    const casa = banco.lugaresDe('50')[0]!;
    await ana.toque(`agro:lugar:usar:${casa.id}`);
    assert.equal(banco.lugar('50')!.id, casa.id);
    const outro = banco.lugaresDe('50')[1]!;
    await ana.toque(`agro:lugar:remover:${outro.id}`);
    assert.deepEqual(banco.lugaresDe('50').map((l) => l.id), [casa.id]);
  });

  it('notificações: um boletim por lugar (com o nome dele); quem só usa o chat web não recebe', async () => {
    const { k7, banco, contexto } = await montar();
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26, 'GO', { apelido: 'Casa' });
    banco.salvarLugar('50', 'Rio Verde/GO', -17.79, -50.92, 'GO', { apelido: 'Sítio' });
    banco.salvarLugar('web-abc123', 'Goiânia/GO', -16.69, -49.26, 'GO');
    await contexto.notificador.ciclo(quando('2026-10-30T06:10'));
    const boletins = k7.enviados.filter((e) => /Boletim/.test(texto(e.mensagem)));
    assert.deepEqual(boletins.map((e) => [e.userId, texto(e.mensagem).split('\n')[0]]), [
      ['50', '🌅 Boletim das 6h · Casa (Goiânia/GO)'],
      ['50', '🌅 Boletim das 6h · Sítio (Rio Verde/GO)'],
    ]);
  });

  it('chat web: buscar a cidade (sem estar lá), com nome; a resposta traz o tempo em imagem; usar, renomear e remover', async () => {
    const { k7, banco } = await montar();
    const nao = await k7.rota('POST', '/api/x/agro/lugares', { busca: 'Lugar Que Não Existe' }, 'web-abc');
    assert.deepEqual([nao.status, /Não achei/.test(nao.dados.erro)], [404, true]);
    const r = await k7.rota('POST', '/api/x/agro/lugares', { busca: 'Rio Verde, GO', apelido: 'Fazenda' }, 'web-abc');
    assert.equal(r.status, 200);
    assert.match(r.dados.resposta.texto, /Lugar salvo: \*\*Fazenda \(Rio Verde\/GO\)\*\*/);
    assert.match(r.dados.resposta.imagens[0].url, /^data:image\/png;base64,/);
    assert.equal(dadosDaPagina(k7.htmls.at(-1)!).lugar, 'Fazenda (Rio Verde/GO)');
    const pelaCoordenada = await k7.rota('POST', '/api/x/agro/lugares', { lat: -16.69, lon: -49.26 }, 'web-abc');
    assert.deepEqual(pelaCoordenada.dados.lugares.map((l: { nome: string; atual: boolean }) => [l.nome, l.atual]), [
      ['Fazenda (Rio Verde/GO)', false],
      ['Goiânia/GO', true],
    ]);
    const fazenda = banco.lugaresDe('web-abc')[0]!;
    await k7.rota('POST', `/api/x/agro/lugares/${fazenda.id}`, { acao: 'usar' }, 'web-abc');
    assert.equal(banco.lugar('web-abc')!.id, fazenda.id);
    await k7.rota('POST', `/api/x/agro/lugares/${fazenda.id}`, { acao: 'renomear', apelido: 'Fazenda Boa Vista' }, 'web-abc');
    assert.equal(banco.lugar('web-abc')!.apelido, 'Fazenda Boa Vista');
    assert.equal((await k7.rota('POST', `/api/x/agro/lugares/${fazenda.id}`, { acao: 'remover' }, 'outra-pessoa')).status, 404, 'lugar de outra pessoa: não mexe');
    await k7.rota('POST', `/api/x/agro/lugares/${fazenda.id}`, { acao: 'remover' }, 'web-abc');
    assert.deepEqual(banco.lugaresDe('web-abc').map((l) => l.nome), ['Goiânia/GO']);
  });

  it('ferramentas: "no sítio" usa aquele lugar; nome desconhecido diz quais lugares existem', async () => {
    const { k7, banco } = await montar();
    banco.salvarLugar('50', 'Goiânia/GO', -16.69, -49.26, 'GO', { apelido: 'Casa' });
    banco.salvarLugar('50', 'Rio Verde/GO', -17.79, -50.92, 'GO', { apelido: 'Sítio Boa Vista' });
    banco.usarLugar('50', banco.lugaresDe('50')[0]!.id);
    const ctx = k7.ctxFerramenta('50');
    assert.match(await k7.ferramentas.get('clima_lavoura')!.run({ lugar: 'sítio' }, ctx), /Sítio Boa Vista \(Rio Verde\/GO\)/);
    await assert.rejects(k7.ferramentas.get('clima_lavoura')!.run({ lugar: 'chácara' }, ctx), (e: { userMessage?: string }) => /Não achei o lugar "chácara"[\s\S]*Casa \(Goiânia\/GO\); Sítio Boa Vista/.test(e.userMessage ?? ''));
    assert.match(await k7.ferramentas.get('definir_planta')!.run({ planta: 'soja', lugar: 'sitio boa vista' }, ctx), /Soja registrada em Sítio Boa Vista/);
    assert.match(await k7.ferramentas.get('meus_lugares')!.run({}, ctx), /● \(em uso\) Casa \(Goiânia\/GO\): 0 planta[\s\S]*Sítio Boa Vista \(Rio Verde\/GO\): 1 planta/);
  });
});
