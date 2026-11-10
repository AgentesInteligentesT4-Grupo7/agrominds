import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { janelasDeChuva, textoChuvaPorHora } from '../extensao/Chuva.js';
import { previsaoSintetica } from './apoio.js';

// 09:00 local (fuso −3 h) = 12:00 UTC.
const AGORA = new Date('2026-10-30T12:00:00Z');

describe('Chuva hora a hora', () => {
  it('o valor das 16h é a chuva entre 15h e 16h: a janela começa uma hora antes', () => {
    const p = previsaoSintetica('2026-10-30T09:00', (hora) =>
      ({ '2026-10-30T16:00': { precipitation: 1, precipitation_probability: 60 }, '2026-10-30T17:00': { precipitation: 6, precipitation_probability: 80 }, '2026-10-30T18:00': { precipitation: 0.5, precipitation_probability: 55 } })[hora] ?? {},
    );
    const [j, ...resto] = janelasDeChuva(p, AGORA);
    assert.equal(resto.length, 0);
    assert.deepEqual(
      { inicio: j!.inicio, fim: j!.fim, mm: j!.mm, probabilidade: j!.probabilidade, pico: j!.pico, intensidade: j!.intensidade },
      { inicio: '2026-10-30T15:00', fim: '2026-10-30T18:00', mm: 7.5, probabilidade: 80, pico: '2026-10-30T16:00', intensidade: 'moderada' },
    );
    const texto = textoChuvaPorHora(p, 'Sítio', AGORA);
    assert.match(texto, /Hoje: das 15h às 18h — provável \(até 80%\), ~8 mm \(moderada\), mais forte entre 16h e 17h/);
    assert.match(texto, /radar/);
  });

  it('chance alta sem milímetros também conta; janelas separadas por hora seca; amanhã pelo nome', () => {
    const p = previsaoSintetica('2026-10-30T09:00', (hora) =>
      ({ '2026-10-30T11:00': { precipitation_probability: 50 }, '2026-10-31T15:00': { precipitation: 12, precipitation_probability: 40 } })[hora] ?? {},
    );
    const janelas = janelasDeChuva(p, AGORA);
    assert.deepEqual(janelas.map((j) => [j.inicio, j.fim, j.intensidade]), [
      ['2026-10-30T10:00', '2026-10-30T11:00', 'fraca'],
      ['2026-10-31T14:00', '2026-10-31T15:00', 'forte'],
    ]);
    assert.match(textoChuvaPorHora(p, 'Sítio', AGORA), /Amanhã: das 14h às 15h — possível \(até 40%\), ~12 mm \(forte\)\n/);
  });

  it('sem chuva no período: diz que não há; respeita o limite de horas', () => {
    const p = previsaoSintetica('2026-10-30T09:00', (hora) => (hora === '2026-11-01T15:00' ? { precipitation: 5 } : {}));
    assert.equal(janelasDeChuva(p, AGORA, 24).length, 0);
    assert.match(textoChuvaPorHora(p, 'Sítio', AGORA, 24), /Sem chuva prevista nessas horas/);
    assert.equal(janelasDeChuva(p, AGORA, 72).length, 1);
  });
});
