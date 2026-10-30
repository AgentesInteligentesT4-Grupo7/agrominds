import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Banco } from '../extensao/Banco.js';
import { Notificador } from '../extensao/Notificador.js';
import type { OpenMeteo } from '../extensao/OpenMeteo.js';
import { Admins } from '../extensao/painel/Admins.js';
import { PainelServidor } from '../extensao/painel/servidor.js';
import { lerCulturas, lerRegras } from '../extensao/Regras.js';
import { K7Falso, lerYaml, previsaoSintetica } from './apoio.js';

const dir = path.resolve('regras');
const regras = () => lerRegras(lerYaml(fs.readFileSync(path.join(dir, 'clima.yaml'), 'utf8')));
const culturas = () => lerCulturas(lerYaml(fs.readFileSync(path.join(dir, 'culturas.yaml'), 'utf8')));

describe('Painel administrativo (API)', () => {
  const k7 = new K7Falso();
  const api = k7.api();
  const banco = new Banco(api.sql);
  const meteo = { previsao: async () => previsaoSintetica(new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 13) + ':00') } as unknown as OpenMeteo;
  const notificador = new Notificador(api, banco, meteo, regras, culturas);
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'agro-dist-'));
  const painel = new PainelServidor({ k7: api, banco, meteo, notificador, regras, culturas, nomeDoLugar: async () => 'x' }, { porta: 0, host: '127.0.0.1', dist });
  let base = '';
  let cookie = '';
  const chamar = (rota: string, metodo = 'GET', corpo?: unknown, extra: Record<string, string> = {}) =>
    fetch(`${base}/api/admin${rota}`, {
      method: metodo,
      headers: { ...(cookie ? { cookie } : {}), ...(metodo !== 'GET' ? { 'x-requested-with': 'k7', 'content-type': 'application/json' } : {}), ...extra },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });

  before(async () => {
    await painel.iniciar();
    base = `http://127.0.0.1:${painel.porta}`;
    await new Admins(api.sql).criar('dono@exemplo.com', 'Dono', 'senha-forte-1', 'admin');
    await new Admins(api.sql).criar('leitor@exemplo.com', 'Leitor', 'senha-forte-2', 'leitura');
    k7.acessos = [
      { userId: 50, nome: 'Ana', username: 'ana', status: 'ativo', origem: 'convite', criadoEm: '2026-10-30 10:00:00', ultimoContato: null },
      { userId: 60, nome: 'Beto', username: null, status: 'pendente', origem: 'pedido', criadoEm: '2026-10-30 11:00:00', ultimoContato: null },
    ];
    banco.salvarLugar('50', 'Goiânia/GO', -16.6869, -49.2648);
    banco.salvarLavoura('50', { cultura: 'soja', fase: 'florescimento', irrigada: true });
  });
  after(() => painel.parar());

  it('sem build do Angular, a página explica como construir; sem login, a API pede para entrar', async () => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 503);
    assert.match(await page.text(), /npm --prefix admin ci/);
    assert.equal((await chamar('/resumo')).status, 401);
  });

  it('login: senha errada recusa; certa abre a sessão em cookie HttpOnly', async () => {
    assert.equal((await chamar('/entrar', 'POST', { email: 'dono@exemplo.com', senha: 'errada' })).status, 401);
    const ok = await chamar('/entrar', 'POST', { email: 'DONO@exemplo.com', senha: 'senha-forte-1' });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly; SameSite=Strict/);
    cookie = setCookie.split(';')[0]!;
    assert.deepEqual(((await (await chamar('/eu')).json()) as { papel: string }).papel, 'admin');
  });

  it('pedido que muda algo sem o cabeçalho do painel é recusado (outro site não consegue)', async () => {
    const r = await fetch(`${base}/api/admin/usuarios/60`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"status":"ativo"}' });
    assert.equal(r.status, 403);
  });

  it('usuários (acesso + lugar + lavoura), aprovar pedido, convite com QR e boletim de teste', async () => {
    const usuarios = (await (await chamar('/usuarios')).json()) as Array<{ userId: string; status: string; lugar: { nome: string } | null; lavoura: { cultura: string } | null }>;
    const ana = usuarios.find((u) => u.userId === '50')!;
    assert.deepEqual([ana.status, ana.lugar?.nome, ana.lavoura?.cultura], ['ativo', 'Goiânia/GO', 'soja']);
    assert.equal((await chamar('/usuarios/60', 'POST', { status: 'ativo' })).status, 200);
    assert.equal(k7.acessos.find((a) => a.userId === 60)!.status, 'ativo');
    const convite = (await (await chamar('/convites', 'POST', { nome: 'Carla' })).json()) as { link: string; qr: string };
    assert.match(convite.link, /^https:\/\/t\.me\/agro_bot\?start=/);
    assert.match(convite.qr, /^data:image\/png;base64,/);
    const teste = (await (await chamar('/usuarios/50/teste', 'POST', {})).json()) as { entregue: boolean };
    assert.equal(teste.entregue, true);
    const envios = (await (await chamar('/envios?usuario=50&tipo=teste')).json()) as Array<{ texto: string }>;
    assert.match(envios[0]!.texto, /Boletim/);
  });

  it('séries do tempo, balanço de água e resumo com o mapa em ponto aproximado', async () => {
    await meteo.previsao('-16.7,-49.3');
    const tempo = (await (await chamar('/usuarios/50/tempo?dias=7')).json()) as { previsao: unknown[]; lugar: { nome: string } };
    assert.equal(tempo.lugar.nome, 'Goiânia/GO');
    assert.ok(tempo.previsao.length > 100);
    const balanco = (await (await chamar('/usuarios/50/balanco')).json()) as { kc: number; serie: unknown[] };
    assert.equal(balanco.kc, 1.15);
    assert.equal(balanco.serie.length, 7);
    const resumo = (await (await chamar('/resumo')).json()) as { usuarios: { ativos: number }; mapa: Array<{ lat: number; lon: number }> };
    assert.equal(resumo.usuarios.ativos, 2);
    assert.deepEqual([resumo.mapa[0]!.lat, resumo.mapa[0]!.lon], [-16.7, -49.3]);
  });

  it('conta de leitura vê, mas não muda nada', async () => {
    const r = await chamar('/entrar', 'POST', { email: 'leitor@exemplo.com', senha: 'senha-forte-2' });
    cookie = r.headers.get('set-cookie')!.split(';')[0]!;
    assert.equal((await chamar('/usuarios')).status, 200);
    assert.equal((await chamar('/usuarios/60', 'POST', { status: 'bloqueado' })).status, 403);
    assert.equal((await chamar('/convites', 'POST', {})).status, 403);
  });
});
