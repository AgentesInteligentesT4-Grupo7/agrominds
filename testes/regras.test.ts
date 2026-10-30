import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Lavoura } from '../extensao/Banco.js';
import { avaliarRegras, avaliarTodas, balancoHidrico, bulboUmido, chaveDe, lerCulturas, lerRegras, quandoLegivel } from '../extensao/Regras.js';
import { lerYaml, previsaoSintetica, quando } from './apoio.js';

const dir = path.resolve('regras');
const regras = lerRegras(lerYaml(fs.readFileSync(path.join(dir, 'clima.yaml'), 'utf8')));
const culturas = lerCulturas(lerYaml(fs.readFileSync(path.join(dir, 'culturas.yaml'), 'utf8')));
const AGORA = '2026-10-30T09:00';
const planta = (p: string, cultura: string, fase: string, irrigada = false): Lavoura => ({ id: 1, userId: '1', planta: p, cultura, fase, irrigada, irrigouEm: null, plantio: null, pendente: false, atualizadoEm: '' });
const soja = (fase: string, irrigada = false) => planta('soja', 'soja', fase, irrigada);
const ids = (r: Array<{ regra: string }>) => r.map((x) => x.regra);

describe('Regras de clima (regras/clima.yaml)', () => {
  it('culturas herdam as fases padrão e mudam só as listadas; café usa só as dele', () => {
    const milho = culturas.find((c) => c.id === 'milho')!;
    assert.equal(milho.fases.inicial!.kc, 0.3);
    assert.equal(milho.fases.vegetativo!.kc, 0.8, 'herdada');
    assert.deepEqual(Object.keys(culturas.find((c) => c.id === 'cafe')!.fases), ['preparo', 'vegetativo', 'florescimento', 'enchimento', 'colheita']);
    assert.ok(regras.every((r) => r.fonte), 'toda regra diz a fonte');
  });

  it('dia comum: sem alertas, com janela de pulverização pela manhã', () => {
    const r = avaliarRegras(regras, previsaoSintetica(AGORA), soja('vegetativo'), culturas, quando(AGORA));
    assert.deepEqual(r.filter((x) => x.alerta), []);
    const pulverizar = r.find((x) => x.regra === 'pulverizacao')!;
    assert.match(pulverizar.texto, /^✅ Pulverização: boas horas hoje 9h–/);
    assert.match(pulverizar.texto, /\(regra em revisão\)$/);
  });

  it('geada: atenção abaixo de 3 °C, grave abaixo de 1 °C, com o dia e a hora', () => {
    const frio = (min: number) => previsaoSintetica(AGORA, (hora, h) => (hora.startsWith('2026-10-31') && h === 5 ? { temperature_2m: min } : {}));
    const atencao = avaliarRegras(regras, frio(2.4), soja('inicial'), culturas, quando(AGORA)).find((x) => x.regra === 'geada')!;
    assert.equal(atencao.severidade, 'atencao');
    assert.match(atencao.texto, /mínima prevista de 2,4°C \(amanhã às 5h\)/);
    assert.equal(atencao.dia, '2026-10-31');
    assert.equal(avaliarRegras(regras, frio(0.6), soja('inicial'), culturas, quando(AGORA)).find((x) => x.regra === 'geada')!.severidade, 'grave');
  });

  it('chuva forte, vento e calor (grave na floração); sem pulverização com vento forte o dia todo', () => {
    const p = previsaoSintetica(AGORA, (hora, h) => ({
      ...(hora.startsWith('2026-10-30') && h === 16 ? { precipitation: 32 } : {}),
      // Vento forte o tempo todo (hoje e amanhã): nenhuma hora boa para pulverizar.
      wind_speed_10m: 22,
      wind_gusts_10m: hora.startsWith('2026-10-30') && h === 15 ? 61 : 30,
      ...(hora.startsWith('2026-10-30') && h === 14 ? { temperature_2m: 36 } : {}),
    }));
    const r = avaliarRegras(regras, p, soja('florescimento'), culturas, quando(AGORA));
    assert.deepEqual(ids(r.filter((x) => x.alerta)).sort(), ['calor', 'chuva_forte', 'vento_forte']);
    assert.equal(r.find((x) => x.regra === 'calor')!.severidade, 'grave', 'calor na floração é grave');
    assert.match(r.find((x) => x.regra === 'pulverizacao')!.texto, /^🚫/);
  });

  it('doença fúngica: muitas horas de folha molhada com temperatura amena, só nas fases em que vale', () => {
    const umido = previsaoSintetica(AGORA, () => ({ relative_humidity_2m: 95, temperature_2m: 22 }));
    assert.ok(ids(avaliarRegras(regras, umido, soja('florescimento'), culturas, quando(AGORA))).includes('doenca_fungica'));
    assert.ok(!ids(avaliarRegras(regras, umido, soja('colheita'), culturas, quando(AGORA))).includes('doenca_fungica'));
  });

  it('sem lavoura cadastrada: só as regras gerais (nada de irrigação, colheita ou plantio)', () => {
    const r = avaliarRegras(regras, previsaoSintetica(AGORA), undefined, culturas, quando(AGORA));
    assert.ok(!ids(r).some((id) => ['irrigacao', 'colheita', 'plantio', 'doenca_fungica'].includes(id)));
  });

  it('irrigação: déficit sem chuva → irrigar; chuva prevista → esperar; só para lavoura irrigada', () => {
    // ET0 de 6,5 mm/dia (0,5 mm por hora de sol): ~52 mm de déficit em 7 dias com Kc 1,15.
    const seco = previsaoSintetica(AGORA, (_hora, h) => ({ et0_fao_evapotranspiration: h >= 6 && h <= 18 ? 0.5 : 0 }));
    const b = balancoHidrico(seco, 1.15, 7, 2, null, quando(AGORA));
    assert.ok(b.deficit > 25, `déficit ${b.deficit}`);
    assert.equal(b.serie.length, 7);
    assert.match(avaliarRegras(regras, seco, soja('florescimento', true), culturas, quando(AGORA)).find((x) => x.regra === 'irrigacao')!.texto, /Vale irrigar/);
    assert.ok(!ids(avaliarRegras(regras, seco, soja('florescimento', false), culturas, quando(AGORA))).includes('irrigacao'));

    const chuvaVindo = previsaoSintetica(AGORA, (hora, h) => ({ et0_fao_evapotranspiration: h >= 6 && h <= 18 ? 0.5 : 0, ...(hora.startsWith('2026-10-31') && h === 15 ? { precipitation: 45 } : {}) }));
    assert.match(avaliarRegras(regras, chuvaVindo, soja('florescimento', true), culturas, quando(AGORA)).find((x) => x.regra === 'irrigacao')!.texto, /pode esperar/);

    // "Irriguei" ontem: a conta recomeça.
    assert.ok(balancoHidrico(seco, 1.15, 7, 2, '2026-10-29 10:00:00', quando(AGORA)).deficit < 10);
  });

  it('várias plantas: aviso geral uma vez (o mais grave); o de fase diz a planta e junta as iguais', () => {
    const frio = previsaoSintetica(AGORA, (hora, h) => ({ relative_humidity_2m: 95, temperature_2m: 22, ...(hora.startsWith('2026-10-31') && h === 5 ? { temperature_2m: 2.4 } : {}) }));
    const nomes = (l: Lavoura) => ({ soja: 'Soja', milho: 'Milho', alface: 'Alface' })[l.planta as 'soja'];
    const lavouras = [soja('florescimento'), planta('milho', 'milho', 'florescimento'), planta('alface', 'hortalicas', 'colheita')];
    const r = avaliarTodas(regras, frio, lavouras, culturas, nomes, quando(AGORA));
    assert.equal(r.filter((x) => x.regra === 'geada').length, 1);
    const fungo = r.filter((x) => x.regra === 'doenca_fungica');
    assert.equal(fungo.length, 1, 'soja e milho na mesma fase: um aviso só');
    assert.match(fungo[0]!.texto, /^Soja e Milho · 🍄/);
    assert.deepEqual(fungo[0]!.plantas, ['soja', 'milho']);
    assert.equal(chaveDe(fungo[0]!), 'doenca_fungica@soja+milho:2026-10-30');
    assert.equal(chaveDe(r.find((x) => x.regra === 'geada')!), 'geada:2026-10-31');
    assert.equal(r.filter((x) => x.regra === 'pulverizacao').length, 1);
  });

  it('bulbo úmido e datas legíveis', () => {
    assert.ok(Math.abs(bulboUmido(25, 50) - 18) < 0.6);
    assert.equal(quandoLegivel('2026-10-30T15:00', AGORA), 'hoje às 15h');
    assert.equal(quandoLegivel('2026-11-01T06:00', AGORA), 'domingo às 6h');
  });
});
