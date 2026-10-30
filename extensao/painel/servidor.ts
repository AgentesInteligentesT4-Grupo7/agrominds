import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { ModoEnvio } from '../Banco.js';
import { UserFacingError, errorMessage } from '../erros.js';
import { horaLocal, somarHoras } from '../OpenMeteo.js';
import { balancoHidrico } from '../Regras.js';
import { calendarioDe, minhasPlantas, plantasDe, previsaoDoPeriodo, tempoAgora } from '../Servicos.js';
import type { Contexto } from '../Servicos.js';
import type { OpcaoPeriodo } from '../Visual.js';
import { type Admin, Admins, type Papel } from './Admins.js';

export interface PainelOpcoes {
  porta: number;
  host: string;
  /** Pasta do build do Angular (admin/dist/admin/browser). */
  dist: string;
}

class HttpErro extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SESSAO_MS = 12 * 3600_000;
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Sobe o painel no processo do bot. Porta ocupada vira aviso (outro processo já está com ele). */
export async function iniciarPainel(c: Contexto, opcoes: PainelOpcoes): Promise<PainelServidor | undefined> {
  const painel = new PainelServidor(c, opcoes);
  try {
    await painel.iniciar();
    c.k7.log.info(`📊 Painel da AgroMinds: http://${opcoes.host === '0.0.0.0' ? '127.0.0.1' : opcoes.host}:${painel.porta}/`);
    if (!new Admins(c.k7.sql).listar().length) c.k7.log.aviso('⚠️ Painel sem administrador: crie com "npm run fita -- agrominds admin-criar <email>"');
    return painel;
  } catch (error) {
    c.k7.log.aviso(`⚠️ Painel da AgroMinds não subiu: ${errorMessage(error)}`);
    return undefined;
  }
}

/**
 * Painel administrativo da AgroMinds (spec §8): API REST em /api/admin e os arquivos do Angular. Login com e-mail e
 * senha (sessão em cookie HttpOnly + SameSite=Strict; pedidos que mudam algo exigem o cabeçalho X-Requested-With).
 * Papéis: `admin` (tudo) e `leitura` (só vê). Por padrão só em 127.0.0.1.
 */
export class PainelServidor {
  private server?: http.Server;
  private readonly sessoes = new Map<string, { admin: Admin; expira: number }>();
  private readonly tentativas = new Map<string, number[]>();
  readonly admins: Admins;

  constructor(
    private readonly c: Contexto,
    private readonly opcoes: PainelOpcoes,
  ) {
    this.admins = new Admins(c.k7.sql);
  }

  get porta(): number {
    const a = this.server?.address();
    return a && typeof a === 'object' ? a.port : this.opcoes.porta;
  }

  iniciar(): Promise<void> {
    this.server = http.createServer((req, res) => void this.rota(req, res));
    return new Promise((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.opcoes.porta, this.opcoes.host, () => resolve());
    });
  }

  parar(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async rota(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      if (!url.pathname.startsWith('/api/')) return this.estatico(url.pathname, res);
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'k7') throw new HttpErro(403, 'Pedido sem o cabeçalho do painel');
      const p = url.pathname.replace(/^\/api\/admin/, '');

      if (req.method === 'POST' && p === '/entrar') return this.json(res, await this.entrar(req, res));
      if (req.method === 'POST' && p === '/sair') {
        const sid = cookie(req, 'agro_sessao');
        if (sid) this.sessoes.delete(sid);
        res.setHeader('set-cookie', 'agro_sessao=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
        return this.json(res, { ok: true });
      }
      const admin = this.sessao(req);
      const escrita = () => {
        if (admin.papel !== 'admin') throw new HttpErro(403, 'Sua conta é só de leitura');
      };
      if (req.method === 'GET' && p === '/eu') return this.json(res, admin);
      if (req.method === 'GET' && p === '/resumo') return this.json(res, this.resumo());
      if (req.method === 'GET' && p === '/culturas') return this.json(res, this.c.culturas());
      if (req.method === 'GET' && p === '/plantas') return this.json(res, this.c.plantas().map((x) => ({ id: x.id, nome: x.nome, grupo: x.grupo, cultura: x.cultura, perene: x.perene, zoneada: x.zarc.length > 0 })));
      if (req.method === 'GET' && p === '/zarc') return this.json(res, { arquivos: this.c.zarc.arquivos() });
      if (req.method === 'GET' && p === '/usuarios') return this.json(res, this.usuarios());
      if (req.method === 'POST' && p === '/convites') {
        escrita();
        const b = (await lerJson(req)) as { nome?: string; dias?: number; usos?: number };
        const convite = await this.c.k7.telegram.acessos.convite({ ...(b.nome ? { nome: String(b.nome) } : {}), ...(b.dias ? { dias: Number(b.dias) } : {}), ...(b.usos ? { usos: Number(b.usos) } : {}) });
        return this.json(res, { link: convite.link, expiraEm: convite.expiraEm, qr: `data:image/png;base64,${convite.png.toString('base64')}` });
      }
      const usuario = /^\/usuarios\/(\d{1,20})(\/[a-z]+)?$/.exec(p);
      if (usuario) {
        const id = usuario[1]!;
        const acao = usuario[2] ?? '';
        if (req.method === 'POST' && acao === '') {
          escrita();
          const { status } = (await lerJson(req)) as { status?: string };
          if (status !== 'ativo' && status !== 'bloqueado') throw new HttpErro(400, 'status: ativo ou bloqueado');
          return this.json(res, { ok: this.c.k7.telegram.acessos.definir(Number(id), status) });
        }
        if (req.method === 'POST' && acao === '/teste') {
          escrita();
          return this.json(res, await this.c.notificador.boletimAgora(id));
        }
        if (req.method === 'POST' && acao === '/plantas') {
          escrita();
          const b = (await lerJson(req)) as { planta?: string; fase?: string; irrigada?: boolean; plantio?: string | null; remover?: boolean };
          const planta = this.c.plantas().find((x) => x.id === b.planta);
          if (!planta) throw new HttpErro(400, 'Planta inválida');
          if (b.remover === true) {
            this.c.banco.removerLavoura(id, planta.id);
            return this.json(res, { ok: true });
          }
          const cultura = this.c.culturas().find((x) => x.id === planta.cultura);
          if (b.fase && !cultura?.fases[b.fase]) throw new HttpErro(400, 'Fase inválida');
          if (b.plantio && !/^\d{4}-\d{2}-\d{2}$/.test(b.plantio)) throw new HttpErro(400, 'Data de plantio: AAAA-MM-DD');
          return this.json(
            res,
            this.c.banco.salvarLavoura(id, planta.id, {
              cultura: planta.cultura,
              ...(b.fase ? { fase: b.fase } : {}),
              ...(typeof b.irrigada === 'boolean' ? { irrigada: b.irrigada } : {}),
              ...(b.plantio !== undefined ? { plantio: b.plantio || null } : {}),
              pendente: false,
            }),
          );
        }
        // O mesmo print que a pessoa recebe no Telegram (para ver e baixar para a apresentação).
        if (req.method === 'GET' && acao === '/imagem') return this.imagem(id, url.searchParams.get('layout') ?? 'tempo', res);
        if (req.method === 'POST' && acao === '/preferencias') {
          escrita();
          const b = (await lerJson(req)) as { modo?: ModoEnvio; horarios?: number[]; pausado?: boolean };
          if (b.modo && !['boletim', 'hora', 'alertas', 'pedir'].includes(b.modo)) throw new HttpErro(400, 'Modo inválido');
          if (b.horarios && !(Array.isArray(b.horarios) && b.horarios.every((h) => Number.isInteger(h) && h >= 0 && h <= 23))) throw new HttpErro(400, 'Horários: horas de 0 a 23');
          return this.json(res, this.c.banco.salvarPreferencias(id, { ...(b.modo ? { modo: b.modo } : {}), ...(b.horarios ? { horarios: b.horarios } : {}), ...(typeof b.pausado === 'boolean' ? { pausado: b.pausado } : {}) }));
        }
        if (req.method === 'GET' && acao === '/tempo') return this.json(res, await this.tempo(id, Number(url.searchParams.get('dias')) || 30));
        if (req.method === 'GET' && acao === '/balanco') return this.json(res, await this.balanco(id, url.searchParams.get('planta') ?? undefined));
      }
      if (req.method === 'GET' && p === '/envios') {
        const q = url.searchParams;
        return this.json(
          res,
          this.c.banco.envios({
            ...(q.get('usuario') ? { userId: q.get('usuario')! } : {}),
            ...(q.get('tipo') ? { tipo: q.get('tipo')! } : {}),
            ...(q.get('q') ? { busca: q.get('q')! } : {}),
            ...(q.get('de') ? { desde: q.get('de')! } : {}),
            ...(q.get('ate') ? { ate: `${q.get('ate')!} 23:59:59` } : {}),
            limite: Number(q.get('limite')) || 300,
          }),
        );
      }
      if (req.method === 'GET' && p === '/administradores') return this.json(res, this.admins.listar());
      if (req.method === 'POST' && p === '/administradores') {
        escrita();
        const b = (await lerJson(req)) as { email?: string; nome?: string; senha?: string; papel?: Papel };
        return this.json(res, await this.admins.criar(String(b.email ?? ''), String(b.nome ?? ''), String(b.senha ?? ''), b.papel === 'admin' ? 'admin' : 'leitura'));
      }
      throw new HttpErro(404, 'Não encontrado');
    } catch (error) {
      const status = error instanceof HttpErro ? error.status : error instanceof UserFacingError || (error instanceof Error && /inválid|precisa/.test(error.message)) ? 400 : 500;
      const message = error instanceof UserFacingError ? error.userMessage : error instanceof Error ? error.message : String(error);
      if (status === 500) this.c.k7.log.erro(`Painel: ${errorMessage(error)}`);
      if (!res.headersSent) this.json(res, { erro: status === 500 ? 'Falha interna; veja o log da fita.' : message }, status);
    }
  }

  private async entrar(req: http.IncomingMessage, res: http.ServerResponse) {
    const ip = req.socket.remoteAddress ?? '?';
    const agora = Date.now();
    const recentes = (this.tentativas.get(ip) ?? []).filter((t) => agora - t < 15 * 60_000);
    if (recentes.length >= 10) throw new HttpErro(429, 'Muitas tentativas; espere alguns minutos.');
    const { email, senha } = (await lerJson(req)) as { email?: string; senha?: string };
    const admin = await this.admins.conferir(String(email ?? ''), String(senha ?? ''));
    if (!admin) {
      this.tentativas.set(ip, [...recentes, agora]);
      throw new HttpErro(401, 'E-mail ou senha incorretos');
    }
    this.tentativas.delete(ip);
    const sid = randomBytes(24).toString('base64url');
    this.sessoes.set(sid, { admin, expira: agora + SESSAO_MS });
    res.setHeader('set-cookie', `agro_sessao=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSAO_MS / 1000}`);
    return admin;
  }

  private sessao(req: http.IncomingMessage): Admin {
    const sid = cookie(req, 'agro_sessao');
    const s = sid ? this.sessoes.get(sid) : undefined;
    if (!s || s.expira < Date.now()) throw new HttpErro(401, 'Entre com seu e-mail e senha');
    return s.admin;
  }

  private usuarios() {
    const { banco } = this.c;
    const acessos = new Map(this.c.k7.telegram.acessos.listar().map((a) => [String(a.userId), a]));
    const ids = new Set([...acessos.keys(), ...banco.lugares().map((l) => l.userId)]);
    return [...ids].map((id) => {
      const a = acessos.get(id);
      const ultimo = banco.envios({ userId: id, limite: 1 })[0];
      return {
        userId: id,
        nome: a?.nome ?? '(dono do bot)',
        username: a?.username ?? null,
        status: a?.status ?? 'ativo',
        origem: a?.origem ?? 'dono',
        criadoEm: a?.criadoEm ?? null,
        ultimoContato: a?.ultimoContato ?? null,
        lugar: banco.lugar(id) ?? null,
        plantas: plantasDe(this.c, id).map((l) => ({ ...l, nome: this.c.plantas().find((x) => x.id === l.planta)?.nome ?? l.planta })),
        preferencias: banco.preferencias(id),
        ultimoEnvio: ultimo ? { quando: ultimo.quando, tipo: ultimo.tipo, entregue: ultimo.entregue } : null,
      };
    });
  }

  private resumo() {
    const { banco, k7 } = this.c;
    const acessos = k7.telegram.acessos.listar();
    const conta = (s: string) => acessos.filter((a) => a.status === s).length;
    const porDia = k7.sql.all<{ dia: string; tipo: string; n: number }>(
      "SELECT substr(quando, 1, 10) AS dia, tipo, COUNT(*) AS n FROM envios WHERE quando >= datetime('now', '-30 days') GROUP BY dia, tipo ORDER BY dia",
    );
    const alertas = k7.sql.all<{ regras: string; severidade: string | null }>("SELECT regras, severidade FROM envios WHERE tipo = 'alerta' AND quando >= datetime('now', '-7 days')");
    const porRegra: Record<string, number> = {};
    for (const a of alertas) for (const r of JSON.parse(a.regras) as string[]) porRegra[r] = (porRegra[r] ?? 0) + 1;
    const severidade = new Map(
      k7.sql
        .all<{ user_id: string; severidade: string }>("SELECT user_id, severidade FROM envios WHERE tipo = 'alerta' AND quando >= datetime('now', '-1 day') AND severidade IS NOT NULL")
        .map((r) => [r.user_id, r.severidade]),
    );
    return {
      usuarios: { ativos: conta('ativo'), pendentes: conta('pendente'), bloqueados: conta('bloqueado') },
      lugares: banco.lugares().length,
      enviosHoje: k7.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM envios WHERE quando >= date('now')")!.n,
      alertasSemana: Object.entries(porRegra).map(([regra, n]) => ({ regra, n })),
      enviosPorDia: porDia,
      // Ponto aproximado (0,1° ≈ 11 km): o mapa não mostra onde a pessoa está.
      mapa: banco.lugares().map((l) => ({ userId: l.userId, nome: l.nome, lat: Number(l.lat.toFixed(1)), lon: Number(l.lon.toFixed(1)), severidade: severidade.get(l.userId) ?? null })),
    };
  }

  /** Séries para os gráficos: ocorrido (histórico), previsão dos próximos dias e previsto × ocorrido. */
  private async tempo(userId: string, dias: number) {
    const lugar = this.c.banco.lugar(userId);
    if (!lugar) throw new HttpErro(404, 'Essa pessoa ainda não mandou a localização');
    const p = await this.c.meteo.previsao(lugar.celula);
    const agora = horaLocal(new Date(), p.utcOffsetSeconds);
    const desde = somarHoras(agora, -24 * Math.min(365, Math.max(1, dias)));
    const ocorrido = this.c.k7.sql.all('SELECT hora, temperatura, umidade, chuva, vento, rajada, et0, vpd FROM historico WHERE celula = ? AND hora >= ? ORDER BY hora', lugar.celula, desde);
    const h = p.horas;
    const previsao = h.time.flatMap((hora, i) =>
      hora >= agora
        ? [{ hora, temperatura: h.temperature_2m?.[i] ?? null, umidade: h.relative_humidity_2m?.[i] ?? null, chuva: h.precipitation?.[i] ?? null, probabilidade: h.precipitation_probability?.[i] ?? null, vento: h.wind_speed_10m?.[i] ?? null, rajada: h.wind_gusts_10m?.[i] ?? null, vpd: h.vapour_pressure_deficit?.[i] ?? null }]
        : [],
    );
    const comparacao = this.c.k7.sql.all(
      `SELECT p.hora, p.temperatura AS previstaTemperatura, o.temperatura AS ocorridaTemperatura, p.chuva AS previstaChuva, o.chuva AS ocorridaChuva
       FROM previsto p JOIN historico o ON o.celula = p.celula AND o.hora = p.hora WHERE p.celula = ? AND p.hora >= ? ORDER BY p.hora`,
      lugar.celula, desde,
    );
    const alertas = this.c.banco.envios({ userId, tipo: 'alerta', limite: 500 }).map((e) => ({ quando: e.quando, regras: e.regras, severidade: e.severidade }));
    return { lugar: { nome: lugar.nome, celula: lugar.celula }, timezone: p.timezone, consultadoEm: p.consultadoEm, ocorrido, previsao, comparacao, alertas };
  }

  /** Conta de água de uma planta (padrão: a primeira irrigada, ou a primeira). */
  private async balanco(userId: string, planta?: string) {
    const lugar = this.c.banco.lugar(userId);
    const lavouras = plantasDe(this.c, userId);
    const lavoura = planta ? lavouras.find((l) => l.planta === planta) : (lavouras.find((l) => l.irrigada) ?? lavouras[0]);
    if (!lugar || !lavoura) throw new HttpErro(404, 'Essa pessoa ainda não tem lugar e plantas cadastrados');
    const kc = this.c.culturas().find((x) => x.id === lavoura.cultura)?.fases[lavoura.fase]?.kc ?? 1;
    const p = await this.c.meteo.previsao(lugar.celula);
    return { planta: lavoura.planta, kc, ...balancoHidrico(p, kc, 7, 2, lavoura.irrigouEm), limite: 25 };
  }

  private async imagem(userId: string, layout: string, res: http.ServerResponse): Promise<void> {
    if (!this.c.banco.lugar(userId)) throw new HttpErro(404, 'Essa pessoa ainda não mandou a localização');
    const s =
      layout === 'plantas' ? await minhasPlantas(this.c, userId)
      : layout === 'calendario' ? await calendarioDe(this.c, userId)
      : layout === 'plantar' ? await calendarioDe(this.c, userId, { todas: true, sugerir: true })
      : layout === 'previsao' ? await previsaoDoPeriodo(this.c, userId, '7' as OpcaoPeriodo)
      : await tempoAgora(this.c, userId, 'clima');
    if (typeof s.mensagem === 'string' || !s.mensagem.imagem) throw new HttpErro(503, 'Não deu para gerar a imagem (sem Chrome/Edge ou AGRO_IMAGEM=off); veja o log da fita.');
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': `inline; filename="agrominds-${layout}.png"` });
    res.end(s.mensagem.imagem);
  }

  /** Arquivos do Angular; rotas desconhecidas devolvem o index.html (navegação do próprio app). */
  private estatico(pathname: string, res: http.ServerResponse): void {
    const raiz = path.resolve(this.opcoes.dist);
    if (!fs.existsSync(path.join(raiz, 'index.html'))) {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
      return void res.end('<p>O painel ainda não foi construído. Na pasta da fita: <code>npm --prefix admin ci</code> e <code>npm --prefix admin run build</code>.</p>');
    }
    let arquivo = path.resolve(raiz, `.${decodeURIComponent(pathname)}`);
    if (!arquivo.startsWith(raiz + path.sep) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) arquivo = path.join(raiz, 'index.html');
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(arquivo)] ?? 'application/octet-stream',
      'cache-control': arquivo.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      // O OpenStreetMap exige o Referer para servir o mapa: só a origem vai, nunca o caminho.
      'referrer-policy': 'strict-origin-when-cross-origin',
      // Estilos inline: ECharts e Leaflet posicionam elementos com style. Mapa base do OpenStreetMap.
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
    });
    fs.createReadStream(arquivo).pipe(res);
  }

  private json(res: http.ServerResponse, dados: unknown, status = 200): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(dados));
  }
}

function cookie(req: http.IncomingMessage, nome: string): string | undefined {
  return new RegExp(`(?:^|;\\s*)${nome}=([\\w-]+)`).exec(String(req.headers.cookie ?? ''))?.[1];
}

async function lerJson(req: http.IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = [];
  let tamanho = 0;
  for await (const parte of req as AsyncIterable<Buffer>) {
    tamanho += parte.length;
    if (tamanho > 64 * 1024) throw new HttpErro(413, 'Pedido grande demais');
    partes.push(parte);
  }
  if (!tamanho) return {};
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new HttpErro(400, 'JSON inválido');
  }
}
