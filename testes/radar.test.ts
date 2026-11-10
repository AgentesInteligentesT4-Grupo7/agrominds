import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateSync } from 'node:zlib';
import { type Grade, Radar, dbzDaCor, kmPorPixel, lerPng, lerRadar, pixelDoMundo, rumo, textoRadar } from '../extensao/Radar.js';

/** PNG RGBA de verdade (filtro 0 numa linha e 1 na outra, para passar pelos dois caminhos do leitor). */
function png(largura: number, altura: number, cor: (x: number, y: number) => [number, number, number, number]): Buffer {
  const linhas: Buffer[] = [];
  for (let y = 0; y < altura; y++) {
    const filtro = y % 2;
    const linha = Buffer.alloc(1 + largura * 4);
    linha[0] = filtro;
    for (let x = 0; x < largura; x++) {
      const px = cor(x, y);
      const ant = x ? cor(x - 1, y) : [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) linha[1 + x * 4 + k] = filtro ? (px[k]! - ant[k]! + 256) & 255 : px[k]!;
    }
    linhas.push(linha);
  }
  const bloco = (nome: string, corpo: Buffer) => {
    const n = Buffer.alloc(4);
    n.writeUInt32BE(corpo.length);
    return Buffer.concat([n, Buffer.from(nome, 'latin1'), corpo, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', ihdr), bloco('IDAT', deflateSync(Buffer.concat(linhas))), bloco('IEND', Buffer.alloc(0))]);
}

/** Grade com uma mancha de chuva redonda (raio em pixels) no centro dado. */
function grade(lado: number, manchas: Array<{ x: number; y: number; raio: number; dbz: number }>): Grade {
  const dbz = new Uint8Array(lado * lado);
  for (const m of manchas) {
    for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) if (Math.hypot(x - m.x, y - m.y) <= m.raio) dbz[y * lado + x] = m.dbz;
  }
  return { lado, dbz };
}

describe('Radar: leitura das imagens', () => {
  it('lê o PNG RGBA (filtros 0 e 1) e converte a cor do esquema Universal Blue em dBZ', () => {
    const imagem = lerPng(png(3, 2, (x, y) => (x === 1 && y === 1 ? [0xff, 0xaa, 0x00, 255] : [0x00, 0xa3, 0xe0, 255])));
    assert.equal(imagem.largura, 3);
    const px = (x: number, y: number) => Array.from(imagem.rgba.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 4));
    assert.deepEqual(px(1, 1), [0xff, 0xaa, 0x00, 255]);
    assert.deepEqual(px(2, 0), [0x00, 0xa3, 0xe0, 255]);
    assert.equal(dbzDaCor(0x00, 0xa3, 0xe0, 255), 20);
    assert.equal(dbzDaCor(0xff, 0xaa, 0x00, 255), 40);
    assert.equal(dbzDaCor(0xfe, 0xab, 0x01, 255), 40, 'cor de borda: a mais próxima');
    assert.equal(dbzDaCor(0x82, 0x7b, 0x69, 0x49), 0, 'translúcido (abaixo de 15 dBZ) não conta');
  });

  it('rumos e escala do mapa', () => {
    assert.equal(rumo(1, 0), 'leste');
    assert.equal(rumo(0, -1), 'norte');
    assert.equal(rumo(-1, 1), 'sudoeste');
    assert.ok(Math.abs(kmPorPixel(-16.7) - 1.17) < 0.02);
    const p = pixelDoMundo(0, 0);
    assert.deepEqual([p.x, p.y], [256 * 64, 256 * 64]);
  });
});

describe('Radar: chuva chegando', () => {
  const P = { x: 256, y: 256 };
  const KM = 1;

  it('mancha a oeste andando para o leste: diz a distância, o movimento e quando chega', () => {
    // 30 px em 30 min (1 km/px) = 60 km/h; a borda da mancha está a 30 km do lugar → ~30 min.
    const antes = grade(512, [{ x: 156, y: 256, raio: 40, dbz: 42 }]);
    const agora = grade(512, [{ x: 186, y: 256, raio: 40, dbz: 42 }]);
    const r = lerRadar(agora, antes, 30, P, KM);
    assert.equal(r.noLugar, 0);
    assert.deepEqual(r.maisPerto, { km: 30, rumo: 'oeste', dbz: 42 });
    assert.equal(r.anda?.rumo, 'leste');
    assert.ok(r.anda!.kmh >= 50 && r.anda!.kmh <= 70, `${r.anda!.kmh} km/h`);
    assert.ok(r.chega && r.chega.minutos >= 25 && r.chega.minutos <= 35, `chega em ${r.chega?.minutos} min`);
    assert.equal(r.chega!.dbz, 42);
  });

  it('mancha andando para longe: não chega', () => {
    const antes = grade(512, [{ x: 186, y: 256, raio: 40, dbz: 35 }]);
    const agora = grade(512, [{ x: 156, y: 256, raio: 40, dbz: 35 }]);
    const r = lerRadar(agora, antes, 30, P, KM);
    assert.equal(r.anda?.rumo, 'oeste');
    assert.equal(r.chega, null);
  });

  it('chovendo no lugar e nada no raio: lê o lugar e não inventa chuva', () => {
    assert.equal(lerRadar(grade(512, [{ x: 256, y: 256, raio: 5, dbz: 33 }]), null, 0, P, KM).noLugar, 33);
    const seco = lerRadar(grade(512, []), grade(512, []), 30, P, KM);
    assert.deepEqual(seco, { noLugar: 0, maisPerto: null, anda: null, chega: null });
  });

  it('texto: chegada com a hora de Brasília, sem citar outros aplicativos; sem radar no lugar, avisa', () => {
    const imagemEm = new Date('2026-11-10T18:00:00Z'); // 15h em Brasília
    const texto = textoRadar(
      { imagemEm, cobertura: 1, cobreLugar: true, leitura: { noLugar: 0, maisPerto: { km: 40, rumo: 'oeste', dbz: 45 }, anda: { kmh: 40, rumo: 'leste' }, chega: { minutos: 60, dbz: 45 } } },
      'Sítio',
      new Date('2026-11-10T18:05:00Z'),
    );
    assert.match(texto, /imagem das 15h \(há 5 min\)/);
    assert.match(texto, /a 40 km, para o oeste \(forte\)/);
    assert.match(texto, /chega por volta das 16h \(em ~1 h\), forte/);
    assert.doesNotMatch(texto, /INMET|Windy|Climatempo/);
    const sem = textoRadar({ imagemEm, cobertura: 0, cobreLugar: false, leitura: { noLugar: 0, maisPerto: null, anda: null, chega: null } }, 'Sítio', imagemEm);
    assert.match(sem, /Nenhum radar meteorológico alcança este lugar/);
  });
});

describe('Radar: busca na RainViewer', () => {
  it('pede só os quadros do mapa (sem a coordenada), guarda o que já baixou e lê a chuva', async () => {
    const pedidos: string[] = [];
    const vazio = png(256, 256, () => [0, 0, 0, 0]);
    const chuva = png(256, 256, () => [0x00, 0x55, 0x88, 255]); // 30 dBZ em tudo
    const resposta = (corpo: unknown) => ({
      ok: true,
      status: 200,
      json: async () => corpo,
      arrayBuffer: async () => {
        const b = corpo as Buffer;
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer;
      },
    });
    const radar = new Radar(async (url) => {
      pedidos.push(url);
      if (url.endsWith('weather-maps.json')) return resposta({ host: 'https://h', radar: { past: [{ time: 1000, path: '/v2/radar/a' }, { time: 2800, path: '/v2/radar/b' }] } });
      return resposta(url.includes('/coverage/') ? vazio : chuva);
    }, () => new Date(3000_000));
    const r = await radar.doLugar(-16.68, -49.25);
    assert.equal(r.cobreLugar, true);
    assert.equal(r.leitura.noLugar, 30);
    assert.equal(r.imagemEm.getTime(), 2800_000);
    assert.ok(pedidos.every((u) => !u.includes('-16.68') && !u.includes('-49.25')), 'a coordenada não sai');
    // 1 índice + 4 quadros de agora + 4 de ~30 min antes + 4 de cobertura.
    assert.equal(pedidos.length, 13);
    await radar.doLugar(-16.68, -49.25);
    assert.equal(pedidos.length, 13, 'segunda consulta: tudo guardado');
  });
});
