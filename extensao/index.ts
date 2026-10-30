import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Banco } from './Banco.js';
import { errorMessage } from './erros.js';
import { registrarFerramentas } from './ferramentas.js';
import type { FitaApi } from './k7.js';
import { Notificador } from './Notificador.js';
import { OpenMeteo } from './OpenMeteo.js';
import { Admins } from './painel/Admins.js';
import { iniciarPainel } from './painel/servidor.js';
import { type Cultura, type Regra, lerCulturas, lerRegras } from './Regras.js';
import { type Contexto, registrarTelegram } from './telegram.js';

/**
 * Extensão da AgroMinds: alertas de clima para a lavoura pelo Telegram (spec specs/alertas-clima.md).
 * - Tempo: Open-Meteo (gratuito, sem chave; OPENMETEO_URL troca o endereço).
 * - Regras: regras/clima.yaml e regras/culturas.yaml (revisáveis sem programar; relidas a cada ciclo).
 * - Envio: tarefa a cada 10 min no processo do bot (boletins nos horários e alertas novos).
 * - Painel administrativo (Angular) em 127.0.0.1:8790 no processo do bot (ADMIN_PORTA, ADMIN_HOST).
 */
export default async function ativar(k7: FitaApi): Promise<void> {
  const env = k7.fita.env;
  const banco = new Banco(k7.sql);
  const meteo = new OpenMeteo(k7.sql, env.OPENMETEO_URL?.trim() || undefined);
  const regrasDir = path.join(k7.fita.dir, 'regras');

  // Relidas quando o arquivo muda: o grupo ajusta um limite e vale no próximo ciclo, sem reiniciar.
  const regras = relendo(path.join(regrasDir, 'clima.yaml'), (t) => lerRegras(k7.util.lerYaml(t)), k7) as () => Regra[];
  const culturas = relendo(path.join(regrasDir, 'culturas.yaml'), (t) => lerCulturas(k7.util.lerYaml(t)), k7) as () => Cultura[];
  regras();
  culturas();

  const notificador = new Notificador(k7, banco, meteo, regras, culturas);
  const contexto: Contexto = { k7, banco, meteo, notificador, regras, culturas, nomeDoLugar: (lat, lon) => nomeDoLugar(lat, lon, env.AGRO_GEOCODIFICAR !== 'off') };
  registrarTelegram(contexto);
  registrarFerramentas(contexto);

  k7.tarefa('boletins e alertas', 10 * 60_000, async () => {
    const r = await notificador.ciclo();
    if (r.boletins || r.alertas) k7.log.info(`📨 ${r.boletins} boletim(ns) e ${r.alertas} alerta(s) enviados`);
  });
  k7.tarefa('limpeza dos dados antigos', 24 * 60 * 60_000, () => banco.limpar());

  // npm run fita -- agrominds admin-criar <email> [--nome "Fulano"] [--leitura]
  k7.comando('admin-criar', 'Cria (ou troca a senha de) uma conta do painel: admin-criar <email> [--nome X] [--leitura]', async (args) => {
    const email = args.find((a) => a.includes('@'));
    if (!email) throw new Error('informe o e-mail: npm run fita -- agrominds admin-criar voce@exemplo.com');
    const nomeIdx = args.indexOf('--nome');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const senha = (await rl.question('Senha do painel (mínimo 8 caracteres): ')).trim();
    rl.close();
    const conta = await new Admins(k7.sql).criar(email, nomeIdx >= 0 ? (args[nomeIdx + 1] ?? '') : '', senha, args.includes('--leitura') ? 'leitura' : 'admin');
    process.stdout.write(`✅ Conta ${conta.email} (${conta.papel}) pronta. Entre em http://127.0.0.1:${Number(env.ADMIN_PORTA) || 8790}/ com o bot ligado.
`);
  });

  k7.aoIniciar(async () => {
    if (!k7.processoPrincipal) return;
    await iniciarPainel(contexto, {
      porta: Number(env.ADMIN_PORTA) || 8790,
      host: env.ADMIN_HOST?.trim() || '127.0.0.1',
      dist: path.join(k7.fita.dir, 'admin', 'dist', 'admin', 'browser'),
    });
  });
}

/** Lê o arquivo e relê só quando ele muda (data de modificação). Erro no YAML mantém a última versão boa. */
function relendo<T>(file: string, parse: (texto: string) => T, k7: FitaApi): () => T {
  let mtime = 0;
  let value: T | undefined;
  return () => {
    const stat = fs.statSync(file);
    if (stat.mtimeMs !== mtime) {
      try {
        value = parse(fs.readFileSync(file, 'utf8'));
        mtime = stat.mtimeMs;
      } catch (error) {
        if (value === undefined) throw error;
        k7.log.aviso(`⚠️ ${path.basename(file)} com erro (${errorMessage(error)}); mantendo a versão anterior`);
        mtime = stat.mtimeMs;
      }
    }
    return value!;
  };
}

/**
 * Cidade/UF da coordenada (OpenStreetMap/Nominatim: 1 pedido por localização, com identificação do app, como pede a
 * política de uso). Sem rede ou desligado (AGRO_GEOCODIFICAR=off), devolve a coordenada arredondada.
 */
async function nomeDoLugar(lat: number, lon: number, geocodificar: boolean): Promise<string> {
  const coordenada = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  if (!geocodificar) return coordenada;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=pt-BR&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
    const r = await fetch(url, { headers: { 'user-agent': 'K7-AgroMinds/0.2 (projeto academico UFG)' }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return coordenada;
    const body = (await r.json()) as { address?: Record<string, string> };
    const a = body.address ?? {};
    const cidade = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
    const uf = /^BR-([A-Z]{2})$/.exec(a['ISO3166-2-lvl4'] ?? '')?.[1] ?? a.state;
    return cidade ? `${cidade}${uf ? `/${uf}` : ''}` : coordenada;
  } catch {
    return coordenada;
  }
}
