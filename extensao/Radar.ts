import { inflateSync } from 'node:zlib';
import { UserFacingError, errorMessage } from './erros.js';

/**
 * Chuva agora pelo radar (RainViewer: mosaico dos radares meteorológicos, grátis para uso pessoal e educativo, imagens
 * dos últimos 2 h a cada 10 min). Desde 2026 a RainViewer não entrega mais previsão (nowcast); aqui ela é feita por
 * extrapolação: compara a imagem de agora com a de ~30 min antes, mede para onde a chuva anda e, se continuar assim,
 * quando chega no lugar.
 *
 * Privacidade: a coordenada da pessoa não sai daqui. Os quadros pedidos são os do mapa (zoom 7, ~300 km de lado),
 * e as contas são feitas aqui dentro.
 */

const ZOOM = 7;
const TILE = 256;
/** Grade de 2 × 2 quadros em volta do ponto: o ponto fica a pelo menos ~150 km da borda. */
const MOSAICO = TILE * 2;
const RAIO_KM = 150;
/** dBZ mínimo para contar como chuva (abaixo disso é garoa fraca ou ruído). */
const CHUVA_DBZ = 20;
/** Projeção da chegada só até 3 h: além disso a chuva muda demais. */
const MAX_ETA_MIN = 180;

/**
 * Esquema "Universal Blue" (o único que a RainViewer mantém): cor → dBZ, de 15 dBZ para cima (abaixo disso a cor é
 * translúcida e não conta). Tabela oficial: https://www.rainviewer.com/files/rainviewer_api_colors_table.csv
 */
const CORES: Array<[number, number]> = (
  [
    [15, '88ddee'], [16, '6cd1eb'], [17, '51c5e8'], [18, '36bae5'], [19, '1baee2'], [20, '00a3e0'], [21, '009ad5'],
    [22, '0091ca'], [23, '0088bf'], [24, '007fb4'], [25, '0077aa'], [26, '0070a3'], [27, '00699c'], [28, '006295'],
    [29, '005b8e'], [30, '005588'], [31, '005180'], [32, '004e78'], [33, '004a70'], [34, '004768'], [35, 'ffee00'],
    [36, 'ffe000'], [37, 'ffd200'], [38, 'ffc500'], [39, 'ffb700'], [40, 'ffaa00'], [41, 'ff9f00'], [42, 'ff9500'],
    [43, 'ff8b00'], [44, 'ff8100'], [45, 'ff4400'], [46, 'f23600'], [47, 'e62800'], [48, 'd91b00'], [49, 'cd0d00'],
    [50, 'c10000'], [51, 'a80000'], [52, '8f0000'], [53, '760000'], [54, '5d0000'], [55, 'ffaaff'], [56, 'ff9fff'],
    [57, 'ff95ff'], [58, 'ff8bff'], [59, 'ff81ff'], [60, 'ff77ff'], [61, 'ff6cff'], [62, 'ff62ff'], [63, 'ff58ff'],
    [64, 'ff4eff'], [65, 'ffffff'],
  ] as Array<[number, string]>
).map(([dbz, hex]) => [dbz, parseInt(hex, 16)]);

const exatas = new Map(CORES.map(([dbz, rgb]) => [rgb, dbz]));

/** dBZ de um pixel (0 = sem chuva). Cor fora da tabela (borda suavizada): a mais próxima. */
export function dbzDaCor(r: number, g: number, b: number, a: number): number {
  if (a < 200) return 0;
  const rgb = (r << 16) | (g << 8) | b;
  const exata = exatas.get(rgb);
  if (exata !== undefined) return exata;
  let melhor = 0;
  let menor = Infinity;
  for (const [dbz, cor] of CORES) {
    const d = (r - (cor >> 16)) ** 2 + (g - ((cor >> 8) & 255)) ** 2 + (b - (cor & 255)) ** 2;
    if (d < menor) [menor, melhor] = [d, dbz];
  }
  return menor <= 40 * 40 * 3 ? melhor : 0;
}

/** PNG de 8 bits (RGBA, RGB ou paleta), sem entrelaçamento: o que os quadros da RainViewer usam. */
export function lerPng(png: Buffer): { largura: number; altura: number; rgba: Uint8Array } {
  if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('não é PNG');
  let pos = 8;
  let largura = 0;
  let altura = 0;
  let tipo = 0;
  let paleta: Buffer | undefined;
  let transparencia: Buffer | undefined;
  const dados: Buffer[] = [];
  while (pos + 8 <= png.length) {
    const n = png.readUInt32BE(pos);
    const nome = png.toString('latin1', pos + 4, pos + 8);
    const corpo = png.subarray(pos + 8, pos + 8 + n);
    if (nome === 'IHDR') {
      largura = corpo.readUInt32BE(0);
      altura = corpo.readUInt32BE(4);
      tipo = corpo[9]!;
      if (corpo[8] !== 8 || corpo[12] !== 0) throw new Error('PNG fora do formato esperado');
    } else if (nome === 'PLTE') paleta = corpo;
    else if (nome === 'tRNS') transparencia = corpo;
    else if (nome === 'IDAT') dados.push(corpo);
    else if (nome === 'IEND') break;
    pos += 12 + n;
  }
  const canais = tipo === 6 ? 4 : tipo === 2 ? 3 : tipo === 3 ? 1 : 0;
  if (!canais || (tipo === 3 && !paleta)) throw new Error(`PNG de tipo ${tipo} não suportado`);
  const bruto = inflateSync(Buffer.concat(dados));
  const linha = largura * canais;
  const rgba = new Uint8Array(largura * altura * 4);
  let anterior = new Uint8Array(linha);
  for (let y = 0; y < altura; y++) {
    const inicio = y * (linha + 1);
    const filtro = bruto[inicio]!;
    const atual = Uint8Array.from(bruto.subarray(inicio + 1, inicio + 1 + linha));
    for (let x = 0; x < linha; x++) {
      const a = x >= canais ? atual[x - canais]! : 0;
      const b = anterior[x]!;
      const c = x >= canais ? anterior[x - canais]! : 0;
      let v = atual[x]!;
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      atual[x] = v & 255;
    }
    for (let x = 0; x < largura; x++) {
      const o = (y * largura + x) * 4;
      if (tipo === 3) {
        const i = atual[x]!;
        rgba.set([paleta![i * 3]!, paleta![i * 3 + 1]!, paleta![i * 3 + 2]!, transparencia?.[i] ?? 255], o);
      } else {
        const s = x * canais;
        rgba.set([atual[s]!, atual[s + 1]!, atual[s + 2]!, canais === 4 ? atual[s + 3]! : 255], o);
      }
    }
    anterior = atual;
  }
  return { largura, altura, rgba };
}

/** Grade de dBZ (0 = sem chuva), linha a linha, de lado `lado`. */
export interface Grade {
  lado: number;
  dbz: Uint8Array;
}

/** Ponto em pixels do mapa mundial (Web Mercator) no zoom dado. */
export function pixelDoMundo(lat: number, lon: number, zoom = ZOOM): { x: number; y: number } {
  const n = TILE * 2 ** zoom;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

/** Quilômetros por pixel no zoom dado, na latitude do lugar. */
export function kmPorPixel(lat: number, zoom = ZOOM): number {
  return (156_543.033_92 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom / 1000;
}

const RUMOS = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'];

/** Rumo de um deslocamento em pixels (x para o leste, y para o sul). */
export function rumo(dx: number, dy: number): string {
  const graus = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  return RUMOS[Math.round(graus / 45) % 8]!;
}

export function intensidade(dbz: number): string {
  return dbz >= 50 ? 'muito forte' : dbz >= 40 ? 'forte' : dbz >= 30 ? 'moderada' : 'fraca';
}

/** Movimento da chuva entre duas imagens: deslocamento em pixels por minuto (null = sem chuva bastante para medir). */
export function movimento(antes: Grade, agora: Grade, minutos: number): { vx: number; vy: number } | null {
  const BLOCO = 4;
  const lado = Math.floor(agora.lado / BLOCO);
  const reduzir = (g: Grade) => {
    const r = new Float32Array(lado * lado);
    for (let y = 0; y < g.lado; y++) {
      for (let x = 0; x < g.lado; x++) {
        const v = g.dbz[y * g.lado + x]!;
        const i = Math.floor(y / BLOCO) * lado + Math.floor(x / BLOCO);
        if (v >= CHUVA_DBZ && v - CHUVA_DBZ + 1 > r[i]!) r[i] = v - CHUVA_DBZ + 1;
      }
    }
    return r;
  };
  const a = reduzir(antes);
  const b = reduzir(agora);
  const celulas = (r: Float32Array) => r.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
  if (celulas(a) < 15 || celulas(b) < 15) return null;
  // Até ~110 km/h: 12 blocos de 4 px (~4,7 km) em 30 min.
  const MAX = Math.max(3, Math.min(16, Math.round((12 * minutos) / 30)));
  const nota = (dx: number, dy: number) => {
    let soma = 0;
    for (let y = Math.max(0, -dy); y < Math.min(lado, lado - dy); y++) {
      for (let x = Math.max(0, -dx); x < Math.min(lado, lado - dx); x++) {
        const va = a[y * lado + x]!;
        if (va) soma += Math.min(va, b[(y + dy) * lado + x + dx]!);
      }
    }
    return soma;
  };
  let melhor = { dx: 0, dy: 0, nota: nota(0, 0) };
  for (let dy = -MAX; dy <= MAX; dy++) {
    for (let dx = -MAX; dx <= MAX; dx++) {
      const n = nota(dx, dy);
      if (n > melhor.nota) melhor = { dx, dy, nota: n };
    }
  }
  // Pouca coincidência entre as imagens: a chuva se formou ou se desfez, e o movimento não se mede.
  const total = b.reduce((s, v) => s + v, 0);
  if (melhor.nota < total * 0.25) return null;
  return { vx: (melhor.dx * BLOCO) / minutos, vy: (melhor.dy * BLOCO) / minutos };
}

export interface LeituraDoRadar {
  /** dBZ no lugar agora (maior num raio de ~2 km; 0 = sem chuva). */
  noLugar: number;
  /** Chuva mais perto (no raio de ~150 km). */
  maisPerto: { km: number; rumo: string; dbz: number } | null;
  /** Para onde a chuva anda (null = não deu para medir). */
  anda: { kmh: number; rumo: string } | null;
  /** Chegada no lugar se continuar no mesmo rumo e velocidade (até 3 h). */
  chega: { minutos: number; dbz: number } | null;
}

/** Lê a grade de agora (e a de antes, para o movimento) em volta do ponto `p` (pixel dentro da grade). */
export function lerRadar(agora: Grade, antes: Grade | null, minutos: number, p: { x: number; y: number }, km: number): LeituraDoRadar {
  const L = agora.lado;
  const em = (x: number, y: number) => agora.dbz[y * L + x]!;
  const raio = RAIO_KM / km;
  const perto = 2 / km;
  let noLugar = 0;
  let maisPerto: { d: number; x: number; y: number } | null = null;
  const chuva: Array<{ x: number; y: number; dbz: number }> = [];
  for (let y = 0; y < L; y++) {
    for (let x = 0; x < L; x++) {
      const v = em(x, y);
      if (!v) continue;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d <= perto && v > noLugar) noLugar = v;
      if (v < CHUVA_DBZ || d > raio) continue;
      chuva.push({ x, y, dbz: v });
      if (!maisPerto || d < maisPerto.d) maisPerto = { d, x, y };
    }
  }
  // Força da chuva mais perto: o mais forte num raio de ~10 km em volta dela (o pixel da borda é sempre fraco).
  let forca = 0;
  if (maisPerto) {
    const r = 10 / km;
    for (const c of chuva) if (Math.hypot(c.x - maisPerto.x, c.y - maisPerto.y) <= r && c.dbz > forca) forca = c.dbz;
  }
  const v = antes ? movimento(antes, agora, minutos) : null;
  const pxMin = v ? Math.hypot(v.vx, v.vy) : 0;
  const kmh = pxMin * km * 60;
  let chega: LeituraDoRadar['chega'] = null;
  if (v && kmh >= 5) {
    const [ux, uy] = [v.vx / pxMin, v.vy / pxMin];
    const faixa = 4 / km;
    const chegadas: Array<{ minutos: number; dbz: number }> = [];
    for (const c of chuva) {
      const [rx, ry] = [p.x - c.x, p.y - c.y];
      const ao = rx * ux + ry * uy;
      if (ao <= 0 || Math.abs(rx * uy - ry * ux) > faixa) continue;
      const min = ao / pxMin;
      if (min <= MAX_ETA_MIN) chegadas.push({ minutos: min, dbz: c.dbz });
    }
    if (chegadas.length) {
      const primeira = Math.min(...chegadas.map((c) => c.minutos));
      // A força que chega: a mais forte na primeira meia hora de chuva.
      const dbz = Math.max(...chegadas.filter((c) => c.minutos <= primeira + 30).map((c) => c.dbz));
      chega = { minutos: Math.round(primeira), dbz };
    }
  }
  return {
    noLugar,
    maisPerto: maisPerto ? { km: Math.round(maisPerto.d * km), rumo: rumo(maisPerto.x - p.x, maisPerto.y - p.y), dbz: forca } : null,
    anda: v ? { kmh: Math.round(kmh), rumo: kmh < 5 ? 'parada' : rumo(v.vx, v.vy) } : null,
    chega,
  };
}

interface Quadro {
  time: number;
  path: string;
}

export interface RadarDoLugar {
  leitura: LeituraDoRadar;
  /** Hora da imagem mais recente (UTC). */
  imagemEm: Date;
  /** Fração do raio de ~150 km que algum radar enxerga (0 a 1); no próprio lugar: `cobreLugar`. */
  cobertura: number;
  cobreLugar: boolean;
}

type Buscar = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

export class Radar {
  private indice?: { em: number; host: string; quadros: Quadro[] };
  private readonly quadros = new Map<string, Promise<Uint8Array>>();

  constructor(
    private readonly buscar: Buscar = (url, init) => fetch(url, init),
    private readonly agora: () => Date = () => new Date(),
    private readonly base = 'https://api.rainviewer.com/public/weather-maps.json',
  ) {}

  /** Radar em volta do lugar: a imagem mais recente, a de ~30 min antes e a cobertura dos radares. */
  async doLugar(lat: number, lon: number): Promise<RadarDoLugar> {
    try {
      const { host, quadros } = await this.lerIndice();
      const ultimo = quadros.at(-1);
      if (!ultimo) throw new Error('sem imagens de radar no índice');
      // ~30 min antes (entre 20 e 40): o bastante para medir o movimento sem a chuva mudar demais.
      const antes = [...quadros].reverse().find((q) => ultimo.time - q.time >= 20 * 60 && ultimo.time - q.time <= 40 * 60) ?? null;
      const mundo = pixelDoMundo(lat, lon);
      const tx = Math.floor(mundo.x / TILE);
      const ty = Math.floor(mundo.y / TILE);
      const x0 = mundo.x - tx * TILE < TILE / 2 ? tx - 1 : tx;
      const y0 = mundo.y - ty * TILE < TILE / 2 ? ty - 1 : ty;
      const p = { x: Math.floor(mundo.x - x0 * TILE), y: Math.floor(mundo.y - y0 * TILE) };
      const km = kmPorPixel(lat);
      const radar = (q: Quadro) => (x: number, y: number) => `${host}${q.path}/${TILE}/${ZOOM}/${x}/${y}/2/0_0.png`;
      const cobertura = (x: number, y: number) => `${host}/v2/coverage/0/${TILE}/${ZOOM}/${x}/${y}/0/0_0.png`;
      const [gAgora, gAntes, gCobertura] = await Promise.all([
        this.mosaico(radar(ultimo), x0, y0, dbzDaCor),
        antes ? this.mosaico(radar(antes), x0, y0, dbzDaCor) : Promise.resolve(null),
        // Na camada de cobertura, a área sem radar vem pintada; a coberta, transparente.
        this.mosaico(cobertura, x0, y0, (_r, _g, _b, a) => (a > 0 ? 0 : 1)).catch(() => null),
      ]);
      let dentro = 0;
      let coberto = 0;
      if (gCobertura) {
        const raio = RAIO_KM / km;
        for (let y = 0; y < MOSAICO; y++) {
          for (let x = 0; x < MOSAICO; x++) {
            if (Math.hypot(x - p.x, y - p.y) > raio) continue;
            dentro++;
            coberto += gCobertura.dbz[y * MOSAICO + x]!;
          }
        }
      }
      return {
        leitura: lerRadar(gAgora, gAntes, antes ? (ultimo.time - antes.time) / 60 : 0, p, km),
        imagemEm: new Date(ultimo.time * 1000),
        cobertura: gCobertura && dentro ? coberto / dentro : 1,
        cobreLugar: gCobertura ? gCobertura.dbz[p.y * MOSAICO + p.x] === 1 : true,
      };
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      throw new UserFacingError('Não consegui ler o radar agora (o serviço não respondeu). Tente de novo daqui a pouco.', errorMessage(error), { cause: error });
    }
  }

  private async lerIndice(): Promise<{ host: string; quadros: Quadro[] }> {
    const agora = this.agora().getTime();
    if (this.indice && agora - this.indice.em < 60_000) return this.indice;
    const resposta = await this.buscar(this.base, { signal: AbortSignal.timeout(15_000) });
    if (!resposta.ok) throw new Error(`índice do radar: HTTP ${resposta.status}`);
    const dados = (await resposta.json()) as { host?: string; radar?: { past?: Quadro[] } };
    const quadros = (dados.radar?.past ?? []).filter((q) => typeof q.time === 'number' && typeof q.path === 'string');
    this.indice = { em: agora, host: dados.host ?? 'https://tilecache.rainviewer.com', quadros };
    return this.indice;
  }

  /** 2 × 2 quadros a partir de (x0, y0), convertidos pixel a pixel. Cada quadro fica guardado (a imagem não muda). */
  private async mosaico(url: (x: number, y: number) => string, x0: number, y0: number, valor: (r: number, g: number, b: number, a: number) => number): Promise<Grade> {
    const dbz = new Uint8Array(MOSAICO * MOSAICO);
    const n = 2 ** ZOOM;
    await Promise.all(
      [0, 1].flatMap((j) =>
        [0, 1].map(async (i) => {
          const rgba = await this.quadro(url((((x0 + i) % n) + n) % n, y0 + j));
          for (let y = 0; y < TILE; y++) {
            for (let x = 0; x < TILE; x++) {
              const o = (y * TILE + x) * 4;
              dbz[(j * TILE + y) * MOSAICO + i * TILE + x] = valor(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!);
            }
          }
        }),
      ),
    );
    return { lado: MOSAICO, dbz };
  }

  private quadro(url: string): Promise<Uint8Array> {
    const guardado = this.quadros.get(url);
    if (guardado) return guardado;
    const pedido = (async () => {
      const resposta = await this.buscar(url, { signal: AbortSignal.timeout(15_000) });
      if (!resposta.ok) throw new Error(`quadro do radar: HTTP ${resposta.status}`);
      const png = lerPng(Buffer.from(await resposta.arrayBuffer()));
      if (png.largura !== TILE || png.altura !== TILE) throw new Error('quadro do radar com tamanho inesperado');
      return png.rgba;
    })();
    pedido.catch(() => this.quadros.delete(url));
    this.quadros.set(url, pedido);
    // Guarda só os mais recentes (cada imagem nova tem outro endereço).
    while (this.quadros.size > 120) this.quadros.delete(this.quadros.keys().next().value!);
    return pedido;
  }
}

const horaMin = (d: Date) => {
  const local = new Date(d.getTime() - 3 * 3600_000);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
};

/** Texto para o agente (e para quem não recebe imagem). Horário de Brasília. */
export function textoRadar(r: RadarDoLugar, lugar: string, agora: Date): string {
  const idade = Math.max(0, Math.round((agora.getTime() - r.imagemEm.getTime()) / 60_000));
  const linhas = [`📡 Radar · ${lugar} · imagem das ${horaMin(r.imagemEm)} (há ${idade} min)`];
  if (!r.cobreLugar) {
    linhas.push(
      'Nenhum radar meteorológico alcança este lugar, então não dá para ver a chuva chegando por aqui. ' +
        'A previsão hora a hora continua valendo.',
    );
    return linhas.join('\n');
  }
  const { noLugar, maisPerto, anda, chega } = r.leitura;
  linhas.push(noLugar >= CHUVA_DBZ ? `• No lugar: chovendo agora (${intensidade(noLugar)}).` : noLugar ? '• No lugar: chuvisco ou garoa fraca agora.' : '• No lugar: sem chuva agora.');
  linhas.push(maisPerto ? `• Chuva mais perto: a ${maisPerto.km} km, para o ${maisPerto.rumo} (${intensidade(maisPerto.dbz)}).` : `• Nenhuma chuva no radar num raio de ~${RAIO_KM} km.`);
  if (maisPerto || noLugar >= CHUVA_DBZ) {
    if (!anda) linhas.push('• Movimento: não deu para medir (a chuva está se formando ou se desfazendo).');
    else if (anda.rumo === 'parada') linhas.push('• Movimento: a chuva está praticamente parada.');
    else linhas.push(`• Movimento: a chuva anda para o ${anda.rumo}, ~${anda.kmh} km/h.`);
    if (chega && noLugar < CHUVA_DBZ) {
      const em = new Date(r.imagemEm.getTime() + chega.minutos * 60_000);
      const quando = chega.minutos < 60 ? `~${Math.max(10, Math.round(chega.minutos / 10) * 10)} min` : `~${(Math.round(chega.minutos / 30) / 2).toString().replace('.', ',')} h`;
      linhas.push(`• Chegada: se continuar assim, chega por volta das ${horaMin(em)} (em ${quando}), ${intensidade(chega.dbz)}.`);
    } else if (anda && anda.rumo !== 'parada' && noLugar < CHUVA_DBZ && maisPerto) {
      linhas.push('• Chegada: pelo rumo de agora, a chuva perto não vem para o lugar nas próximas 3 h.');
    }
  }
  if (r.cobertura < 0.7) linhas.push('Parte da região fica fora do alcance dos radares: chuva vinda de lá não aparece.');
  linhas.push(
    'O radar mostra a chuva que já existe: pancadas novas podem se formar de repente, e a chuva muda de rumo e de força. ' +
      'Para as próximas horas e dias, a previsão hora a hora.',
    'Radar: RainViewer (uso pessoal e educativo).',
  );
  return linhas.join('\n');
}
