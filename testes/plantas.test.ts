import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { Lavoura } from '../extensao/Banco.js';
import { Layouts } from '../extensao/Layouts.js';
import { calendario, culturasDoZarc, decendioDe, diaDoDecendio, faixas, faseAtual, janelaDeColheita, sugestoes, textoCiclo, textoFaixa } from '../extensao/Plantas.js';
import { Zarc, chaveDeNome } from '../extensao/Zarc.js';
import { dadosAlerta, dadosCalendario, dadosPlantas, dadosPrevisao, dadosTempo, periodoDe } from '../extensao/Visual.js';
import { K7Falso, culturasDaFita, emLinhas, plantasDaFita, playwright, previsaoSintetica, quando, sqlEmMemoria, tabuaZarc } from './apoio.js';

const plantas = plantasDaFita();
const culturas = culturasDaFita();
const lavoura = (planta: string, dados: Partial<Lavoura> = {}): Lavoura => ({ id: 1, userId: '1', lugarId: 1, planta, cultura: plantas.find((p) => p.id === planta)!.cultura, fase: 'vegetativo', irrigada: false, irrigouEm: null, plantio: null, pendente: false, atualizadoEm: '', ...dados });

async function zarcDeExemplo(): Promise<Zarc> {
  const z = new Zarc(sqlEmMemoria());
  await z.importar(emLinhas(tabuaZarc()), culturasDoZarc(plantas), { arquivo: 'safra', nome: 'Tábua de risco - Safra 2026/2027', url: 'teste' });
  return z;
}

describe('Catálogo de plantas (regras/plantas.yaml)', () => {
  it('toda planta aponta para uma cultura de culturas.yaml; nenhuma época inventada (só culturas do ZARC)', () => {
    for (const p of plantas) assert.ok(culturas.some((c) => c.id === p.cultura), `${p.id} → ${p.cultura}`);
    assert.ok(plantas.some((p) => p.grupo === 'horta') && plantas.some((p) => p.grupo === 'lavoura'));
    assert.ok(culturasDoZarc(plantas).has('Mandioca (aipim, macaxeira)'), 'nome com vírgula entre aspas no YAML');
    assert.deepEqual(plantas.find((p) => p.id === 'alface')!.zarc, [], 'alface: sem zoneamento oficial');
  });

  it('decêndios: data → decêndio, faixas que viram o ano, texto', () => {
    assert.deepEqual([decendioDe('2026-01-10'), decendioDe('2026-01-11'), decendioDe('2026-10-30'), decendioDe('2026-12-31')], [1, 2, 30, 36]);
    assert.deepEqual([diaDoDecendio(27), diaDoDecendio(26), diaDoDecendio(1, true), diaDoDecendio(6, true)], ['21/set', '11/set', '10/jan', '28/fev']);
    const risco = new Array(36).fill(0);
    for (const d of [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 1, 2]) risco[d - 1] = d === 26 ? 40 : 20;
    risco[9] = 30;
    assert.deepEqual(faixas(risco), [{ inicio: 10, fim: 10, risco: 30 }, { inicio: 26, fim: 2, risco: 40 }]);
    assert.equal(textoFaixa(faixas(risco)[1]!), '11/set a 20/jan');
    assert.equal(textoFaixa(faixas(new Array(36).fill(20))[0]!), 'o ano todo');
  });

  it('colheita: a janela de plantio andada o ciclo (vira o ano); perene e ciclo de 1 ano ou mais não têm faixa', () => {
    const risco = new Array(36).fill(0);
    for (const d of [27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 1]) risco[d - 1] = 20;
    const colheita = janelaDeColheita(risco, 120)!;
    assert.deepEqual(colheita.flatMap((c, i) => (c ? [i + 1] : [])), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], '~4 meses depois: de fevereiro a maio');
    assert.equal(janelaDeColheita(risco, 365), undefined);
    assert.equal(textoCiclo(120), '~4 meses');
    assert.equal(textoCiclo(45), '~45 dias');
  });

  it('fase pela data de plantio e o ciclo; colheita estimada; perene usa a fase informada', () => {
    const soja = plantas.find((p) => p.id === 'soja')!;
    const cultura = culturas.find((c) => c.id === 'soja')!;
    assert.deepEqual(faseAtual(lavoura('soja', { plantio: '2026-10-20' }), soja, cultura, '2026-10-30'), { fase: 'inicial', dias: 10, colheita: '2027-02-17' });
    assert.equal(faseAtual(lavoura('soja', { plantio: '2026-08-01' }), soja, cultura, '2026-10-30').fase, 'enchimento');
    assert.equal(faseAtual(lavoura('soja', { plantio: '2026-11-15' }), soja, cultura, '2026-10-30').fase, 'preparo');
    assert.equal(faseAtual(lavoura('soja', { plantio: '2026-01-01' }), soja, cultura, '2026-10-30').passou, true);
    const cafe = plantas.find((p) => p.id === 'cafe')!;
    assert.equal(faseAtual(lavoura('cafe', { fase: 'florescimento', plantio: '2020-01-01' }), cafe, culturas.find((c) => c.id === 'cafe'), '2026-10-30').fase, 'florescimento');
  });
});

describe('ZARC (zoneamento agrícola)', () => {
  it('importa só as culturas do catálogo, por município, manejo e classe de solo (menor risco entre ciclos)', async () => {
    const z = await zarcDeExemplo();
    assert.deepEqual(z.arquivos().map((a) => [a.arquivo, a.linhas]), [['safra', 9]]);
    assert.deepEqual(z.municipio('GOIANIA', 'GO'), { geocodigo: '5208707', nome: 'Goiânia', uf: 'GO' });
    assert.equal(z.municipio('Goiânia', 'SP'), undefined);
    assert.equal(chaveDeNome('São João d’Aliança'), 'saojoaodalianca');
    const [soja] = z.janelas('5208707', ['Soja']);
    assert.deepEqual([soja!.manejo, soja!.solo, soja!.risco[25], soja!.risco[29], soja!.risco[0], soja!.risco[5]], ['Sequeiro', 'medio', 30, 20, 20, 0]);
    assert.equal(z.janelas('5208707', ['Soja'], { solo: 'arenoso' })[0]!.risco[25], 0, 'solo arenoso: janela menor');
    assert.equal(z.janelas('5208707', ['Banana Prata Implantação'])[0]!.manejo, 'Irrigado', 'sem janela em sequeiro: vale a irrigada');
    assert.deepEqual(z.janelas('5208707', ['Palma Forrageira']), [], 'fora do catálogo: não importa');
  });

  it('reimportar o mesmo arquivo substitui; o outro arquivo continua', async () => {
    const z = await zarcDeExemplo();
    await z.importar(emLinhas(tabuaZarc().slice(0, 2)), culturasDoZarc(plantas), { arquivo: 'perene', nome: 'Perene', url: 'teste' });
    await z.importar(emLinhas(tabuaZarc().slice(0, 2)), culturasDoZarc(plantas), { arquivo: 'safra', nome: 'Safra', url: 'teste' });
    assert.deepEqual(z.janelas('5208707', ['Milho 2ª Safra']), []);
    assert.equal(z.janelas('5208707', ['Soja']).length, 1);
  });

  it('atualizar: baixa a safra mais recente que já começou; em dia, não baixa de novo', async () => {
    const pedidos: string[] = [];
    const portal = {
      result: {
        resources: [
          { name: 'Tábua de risco - Safra 2025/2026', url: 'https://x/2025.csv' },
          { name: 'Tábua de risco - Safra 2026/2027', url: 'https://x/2026.csv' },
          { name: 'Tábua de risco - Safra 2027/2028', url: 'https://x/2027.csv' },
          { name: 'Tábua de risco - Perene, Olerícola e Sem Safra', url: 'https://x/perene.csv' },
        ],
      },
    };
    const falso = (async (url: string) => {
      pedidos.push(url);
      if (url.includes('package_show')) return new Response(JSON.stringify(portal));
      return new Response(tabuaZarc().join('\r\n'));
    }) as typeof fetch;
    const z = new Zarc(sqlEmMemoria(), falso);
    const feitos = await z.atualizar(culturasDoZarc(plantas), { agora: new Date('2026-10-30T12:00:00Z') });
    assert.equal(feitos.length, 2);
    assert.deepEqual(pedidos.filter((u) => u.endsWith('.csv')), ['https://x/2026.csv', 'https://x/perene.csv']);
    assert.equal(z.janelas('5208707', ['Soja'])[0]!.risco[25], 30, 'CSV com CRLF lido certo');
    assert.deepEqual(await z.atualizar(culturasDoZarc(plantas), { agora: new Date('2026-11-30T12:00:00Z') }), []);
  });

  it('calendário e sugestões: plantas sem zoneamento e município sem janela ficam marcados', async () => {
    const z = await zarcDeExemplo();
    const escolhidas = ['soja', 'milho', 'alface', 'feijao'].map((id) => plantas.find((p) => p.id === id)!);
    const linhas = calendario(z, '5208707', escolhidas, [lavoura('soja', { plantio: '2026-10-01' })]);
    assert.deepEqual(linhas.map((l) => [l.nome, l.epoca ?? '', l.semDado ?? '']), [
      ['Soja', '', ''],
      ['Milho', '1ª safra', 'nao_indicado'],
      ['Milho', '2ª safra (safrinha)', ''],
      ['Alface', '', 'sem_zoneamento'],
      ['Feijão', '1ª safra', 'nao_indicado'],
      ['Feijão', '2ª safra', 'nao_indicado'],
    ]);
    assert.deepEqual([linhas[0]!.minha, linhas[0]!.plantio, linhas[0]!.colheita], [true, '2026-10-01', '2027-01-29']);
    const s = sugestoes(linhas, '2026-12-25');
    assert.deepEqual(s.agora.map((l) => l.nome), ['Soja']);
    assert.deepEqual(s.logo.map((l) => [l.nome, l.em]), [['Milho', 1]], 'a safrinha abre no próximo decêndio');
  });
});

describe('Layouts (imagens)', () => {
  const p = previsaoSintetica('2026-10-30T09:00', (hora, h) => (hora.startsWith('2026-10-31') && h === 5 ? { temperature_2m: 0.5 } : {}));
  const lugar = { id: 1, userId: '1', nome: 'Goiânia/GO', apelido: null, cidade: 'Goiânia/GO', atual: true, lat: -16.69, lon: -49.26, celula: '-16.7,-49.3', uf: 'GO', atualizadoEm: '' };
  const agora = quando('2026-10-30T09:00');
  const aviso = { regra: 'geada', titulo: 'Risco de geada', severidade: 'grave' as const, texto: '🥶 Geada </script><b>', dia: '2026-10-31', alerta: true };

  it('a página leva o estilo, o script e os dados embutidos; texto dos dados não fecha o <script>', () => {
    const html = new Layouts(new K7Falso().api()).html('alerta', dadosAlerta(p, lugar, [aviso], agora));
    assert.ok(!/<link rel="stylesheet"|<script src=/.test(html), 'nada de arquivo externo');
    assert.ok(html.includes('\\u003c/script>'), 'o "<" dos dados vira \\u003c');
    assert.equal(html.match(/<\/script>/g)!.length, 3, 'só os 3 scripts da página');
  });

  it('período: fim de semana (sábado e domingo), 3 e 14 dias', () => {
    assert.deepEqual(periodoDe('fds', '2026-10-30'), { inicio: '2026-10-31', fim: '2026-11-01', titulo: 'Previsão do fim de semana' });
    assert.deepEqual(periodoDe('fds', '2026-11-01'), { inicio: '2026-11-01', fim: '2026-11-01', titulo: 'Previsão do fim de semana' });
    assert.equal(periodoDe('14', '2026-10-30').fim, '2026-11-12');
  });

  // Print de verdade com o navegador do K7: pega erro de script nos layouts (o que o teste do HTML não vê).
  const navegador = (async () => {
    try {
      return await playwright().chromium.launch({ channel: 'chrome' }).catch(() => playwright().chromium.launch({ channel: 'msedge' }));
    } catch {
      return undefined;
    }
  })();
  after(async () => (await navegador)?.close());

  it('cada layout desenha com dados reais, sem erro de script', async (t) => {
    const browser = await navegador;
    if (!browser) return t.skip('sem Chrome/Edge nesta máquina');
    const z = await zarcDeExemplo();
    const linhas = calendario(z, '5208707', plantas.filter((x) => ['soja', 'milho', 'alface'].includes(x.id)), [lavoura('soja', { plantio: '2026-10-01' })]);
    const layouts = new Layouts(new K7Falso().api());
    const casos = {
      tempo: dadosTempo(p, lugar, 'soja (florindo)', [aviso, { ...aviso, regra: 'pulverizacao', alerta: false, severidade: 'info' as const, texto: '✅ Pulverização: boas horas hoje 9h–11h' }], 'Boletim das 6h', agora),
      previsao: dadosPrevisao(p, lugar, periodoDe('3', '2026-10-30'), agora),
      plantas: dadosPlantas(lugar, [lavoura('soja', { plantio: '2026-10-01' }), lavoura('alface', { irrigada: true })], plantas, culturas, linhas, '2026-10-30', true),
      calendario: dadosCalendario(lugar, linhas, '2026-10-30', { destaque: true, safra: '2026/2027' }),
      alerta: dadosAlerta(p, lugar, [aviso], agora),
    } as const;
    for (const [nome, dados] of Object.entries(casos)) {
      const page = await browser.newPage();
      const erros: string[] = [];
      page.on('pageerror', (e: Error) => erros.push(e.message));
      await page.setContent(layouts.html(nome as keyof typeof casos, dados));
      const conteudo = await page.evaluate('document.getElementById("app").innerText');
      await page.close();
      assert.deepEqual(erros, [], `${nome}: erro de script`);
      assert.match(String(conteudo), /Goiânia\/GO/, `${nome}: desenhou`);
    }
  });
});
