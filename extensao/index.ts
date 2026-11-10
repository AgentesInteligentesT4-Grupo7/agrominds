import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Banco } from './Banco.js';
import { errorMessage } from './erros.js';
import { buscarLugar, nomeDoLugar } from './Geo.js';
import { registrarFerramentas } from './ferramentas.js';
import type { FitaApi } from './k7.js';
import { Layouts } from './Layouts.js';
import { Notificador } from './Notificador.js';
import { OpenMeteo } from './OpenMeteo.js';
import { Radar } from './Radar.js';
import { Admins } from './painel/Admins.js';
import { iniciarPainel } from './painel/servidor.js';
import { type Planta, culturasDoZarc, lerPlantas } from './Plantas.js';
import { type Cultura, type Regra, lerCulturas, lerRegras } from './Regras.js';
import type { Base, Contexto } from './Servicos.js';
import { registrarTelegram } from './telegram.js';
import { registrarWeb } from './web.js';
import { Zarc } from './Zarc.js';

/**
 * Extensão da AgroMinds: tempo e época de plantio pelo Telegram, para quem planta em qualquer escala
 * (spec specs/alertas-clima.md).
 * - Tempo: Open-Meteo (gratuito, sem chave; OPENMETEO_URL troca o endereço).
 * - Chuva agora: radar da RainViewer (gratuito, sem chave, uso pessoal e educativo; AGRO_RADAR=off desliga).
 * - Época de plantio: ZARC (MAPA/Embrapa), baixado do portal de dados abertos uma vez por safra.
 * - Regras e plantas: regras/*.yaml (revisáveis sem programar; relidas quando mudam).
 * - Imagens: layouts/*.html, com os dados dentro, viram "print" (k7.util.htmlParaPng).
 * - Envio: tarefa a cada 10 min no processo do bot (boletins nos horários e alertas novos).
 * - Painel administrativo (Angular) em 127.0.0.1:8790 no processo do bot (ADMIN_PORTA, ADMIN_HOST).
 */
export default async function ativar(k7: FitaApi): Promise<void> {
  const env = k7.fita.env;
  const banco = new Banco(k7.sql);
  const meteo = new OpenMeteo(k7.sql, env.OPENMETEO_URL?.trim() || undefined);
  const zarc = new Zarc(k7.sql);
  const regrasDir = path.join(k7.fita.dir, 'regras');

  // Relidas quando o arquivo muda: o grupo ajusta um limite e vale no próximo ciclo, sem reiniciar.
  const regras = relendo(path.join(regrasDir, 'clima.yaml'), (t) => lerRegras(k7.util.lerYaml(t)), k7) as () => Regra[];
  const culturas = relendo(path.join(regrasDir, 'culturas.yaml'), (t) => lerCulturas(k7.util.lerYaml(t)), k7) as () => Cultura[];
  const plantas = relendo(path.join(regrasDir, 'plantas.yaml'), (t) => lerPlantas(k7.util.lerYaml(t)), k7) as () => Planta[];
  regras();
  culturas();
  plantas();

  const geocodificar = env.AGRO_GEOCODIFICAR !== 'off';
  const base: Base = {
    k7, banco, meteo, zarc, layouts: new Layouts(k7), regras, culturas, plantas,
    ...(env.AGRO_RADAR !== 'off' ? { radar: new Radar() } : {}),
    nomeDoLugar: (lat, lon) => nomeDoLugar(lat, lon, geocodificar),
    buscarLugar: (texto) => buscarLugar(texto, geocodificar),
  };
  const contexto: Contexto = { ...base, notificador: new Notificador(base) };
  registrarTelegram(contexto);
  registrarFerramentas(contexto);
  registrarWeb(contexto);

  k7.tarefa('boletins e alertas', 10 * 60_000, async () => {
    const r = await contexto.notificador.ciclo();
    if (r.boletins || r.alertas) k7.log.info(`📨 ${r.boletins} boletim(ns) e ${r.alertas} alerta(s) enviados`);
  });
  k7.tarefa('limpeza dos dados antigos', 24 * 60 * 60_000, () => banco.limpar());
  // Uma consulta pequena por dia ao portal; o download (~750 MB, lido aos poucos) só quando sai safra nova.
  if (env.AGRO_ZARC !== 'off') {
    k7.tarefa('zoneamento agrícola (ZARC)', 24 * 60 * 60_000, async () => {
      if (zarc.vazio()) k7.log.info('📥 Baixando o zoneamento agrícola (ZARC) do portal do MAPA; leva alguns minutos...');
      for (const feito of await zarc.atualizar(culturasDoZarc(plantas()))) k7.log.info(`📅 ZARC: ${feito}`);
    });
  }

  // npm run fita -- agrominds zarc [--forcar] [--arquivo tabua.csv --tipo safra|perene]
  k7.comando('zarc', 'Atualiza o zoneamento agrícola (ZARC): zarc [--forcar] | zarc --arquivo tabua.csv --tipo safra|perene', async (args) => {
    const i = args.indexOf('--arquivo');
    if (i >= 0) {
      const arquivo = args[i + 1];
      const tipo = args[args.indexOf('--tipo') + 1] === 'perene' ? 'perene' : 'safra';
      if (!arquivo || !fs.existsSync(arquivo)) throw new Error('informe o CSV baixado: zarc --arquivo caminho.csv --tipo safra|perene');
      const linhas = createInterface({ input: createReadStream(arquivo), crlfDelay: Infinity });
      const r = await zarc.importar(linhas, culturasDoZarc(plantas()), { arquivo: tipo, nome: path.basename(arquivo), url: `arquivo local: ${path.basename(arquivo)}` });
      process.stdout.write(`✅ ${r.linhas.toLocaleString('pt-BR')} linhas lidas, ${r.janelas.toLocaleString('pt-BR')} janelas guardadas.\n`);
      return;
    }
    const feitos = await zarc.atualizar(culturasDoZarc(plantas()), { forcar: args.includes('--forcar') });
    process.stdout.write(feitos.length ? `✅ ${feitos.join('\n✅ ')}\n` : '✅ O zoneamento já está em dia (use --forcar para baixar de novo).\n');
  });

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
