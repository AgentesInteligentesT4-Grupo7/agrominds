# 🌱 AgroMinds: fita do K7

Tempo, chuva e época de plantio pelo Telegram e pelo navegador para **quem planta em qualquer escala** (roça, sítio,
horta, quintal ou vaso em casa). Projeto do **Grupo 7** (Agentes Inteligentes T4, UFG).
Proposta completa: [specs/alertas-clima.md](specs/alertas-clima.md).

> [!IMPORTANT]
> **Esta pasta não roda sozinha: ela é uma fita do [K7](https://github.com/AgentesInteligentesT4-Grupo7/K7).**
> O K7 é o "tocador": ele traz o agente de IA, a memória, o Telegram, o chat no navegador e a página de
> administração. A fita traz só o que é da AgroMinds: a identidade do agente, as skills, as regras agronômicas, as
> imagens e o código do tempo, do zoneamento e dos alertas. Primeiro instale o K7; depois instale esta fita nele
> (passo a passo abaixo).

## Sumário

- [Instalar do zero](#instalar-do-zero)
- [Ajustar a fita à sua realidade](#ajustar-a-fita-à-sua-realidade)
- [Atualizar](#atualizar)
- [O que faz](#o-que-faz)
- [De onde vêm os dados](#de-onde-vêm-os-dados)
- [Testes](#testes)
- [Arquivos](#arquivos)

## Instalar do zero

Você vai precisar de: **Node.js 20 ou mais novo**, **Git**, a chave de pelo menos um modelo de IA (Gemini, DeepSeek,
Groq... ou o Ollama rodando no computador) e, para o Telegram, uma conta no Telegram. Para as respostas em imagem, o
**Chrome ou o Edge** instalados (nenhum navegador é baixado; sem navegador, o bot manda só texto).

### 1. Instale o K7 (o tocador)

```bash
git clone https://github.com/AgentesInteligentesT4-Grupo7/K7.git
cd K7
npm install
cp .env.example .env
```

No `.env` do K7, preencha a chave do modelo de IA (por exemplo `GEMINI_API_KEY`) e o seu ID numérico do Telegram em
`TELEGRAM_ALLOWED_USER_IDS` (descubra com o [@userinfobot](https://t.me/userinfobot)): quem está ali é **dono** de
todas as fitas e sempre entra. O próprio `.env.example` explica cada variável.

### 2. Instale a AgroMinds no K7

Ainda na pasta do K7:

```bash
npm run perfil -- instalar AgentesInteligentesT4-Grupo7/agrominds
```

O instalador baixa a fita do GitHub para a pasta de fitas do K7 (`perfis/`, definida por `PERFIS_DIR` no `.env`).
Como a AgroMinds tem código próprio, ele **lista os arquivos de código e só continua se você digitar `sim`**. Nada da
fita é executado durante a instalação.

### 3. Configure o `.env` da fita (opcional)

O instalador cria `perfis/agrominds/.env` a partir do [.env.example](.env.example). Tudo tem um valor padrão que
funciona; mude só se precisar:

| Variável | Para que serve | Padrão |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot do Telegram desta fita (o passo 4 preenche sozinho) | vazio |
| `TELEGRAM_ALLOWED_USER_IDS` | Donos deste bot; vazio = os do `.env` do K7 | vazio |
| `ADMIN_PORTA`, `ADMIN_HOST` | Painel administrativo (Angular) | `8790`, só neste computador |
| `AGRO_GEOCODIFICAR` | Nome da cidade a partir da localização (OpenStreetMap) | `on` |
| `AGRO_IMAGEM` | Respostas em imagem (`off` = só texto) | `on` |
| `AGRO_ZARC` | Baixa o zoneamento agrícola (ZARC) uma vez por safra | `on` |
| `AGRO_RADAR` | Chuva agora pelo radar meteorológico | `on` |
| `OPENMETEO_URL` | Outro endereço da API de previsão | Open-Meteo público |

### 4. Crie o bot do Telegram da fita

Cada fita tem **o seu próprio bot**. Escolha um dos jeitos:

```bash
npm run perfil -- bot agrominds --token      # cola o token de um bot criado no @BotFather
npm run perfil -- bot agrominds --gerente    # o bot gerente do K7 cria o bot (precisa de TELEGRAM_GERENTE_TOKEN no .env do K7)
```

### 5. Ligue

```bash
npm run dev -- --perfil agrominds
```

Isso liga o bot do Telegram, os boletins e alertas automáticos e o painel administrativo. Mande `/start` para o bot e
compartilhe a localização da plantação.

Outros jeitos de ligar:

- **Pela página de administração do K7:** `npm run admin -- --abrir` → fita AgroMinds → **Ligar**. Na mesma página:
  criar o bot, convites com QR, quem pode usar, log.
- **No Docker** (o K7 inteiro em containers): no `.env` do K7, `ADMIN_LIGAR=agrominds` e `PERFIS_DIR_HOST=./perfis`;
  depois `docker compose up -d --build`. Veja a seção "Rodando no Docker" do README do K7.
- **Chat no navegador:** `npm run web -- --perfil agrominds`. No chat, o botão 📍 cadastra o lugar.

### 6. Painel administrativo e zoneamento (opcional)

```bash
npm --prefix perfis/agrominds/admin ci && npm --prefix perfis/agrominds/admin run build   # compila o painel (Angular)
npm run fita -- agrominds admin-criar voce@exemplo.com   # cria a sua conta no painel (pede a senha)
npm run fita -- agrominds zarc                           # baixa o zoneamento agora (senão, vem na primeira tarefa do dia)
```

O painel abre em `http://127.0.0.1:8790` com a fita ligada. O zoneamento lê ~750 MB do portal do MAPA aos poucos e
guarda ~25 MB; leva alguns minutos.

### Quem pode usar o bot

Fica em `telegram.acesso` no [perfil.yaml](perfil.yaml):

- `lista`: só os donos (`TELEGRAM_ALLOWED_USER_IDS`);
- `convite`: os donos e quem recebeu um convite (`/convite <nome>` no bot devolve o QR code); com `pedidos: true`,
  quem chega sem convite vira um pedido que os donos aprovam no Telegram;
- `aberto`: qualquer pessoa, com limite de mensagens por hora (é o valor atual).

## Ajustar a fita à sua realidade

A fita foi feita para ser adaptada: limites dos alertas, plantas, textos e imagens mudam sem programar.

| Quero mudar | Onde | Some ao atualizar? |
|---|---|---|
| Bot, donos, ligar ou desligar recursos | `.env` da fita | **Não**: o `.env` é sempre mantido |
| Limites dos alertas (geada, calor, chuva, vento...) e recomendações | `regras/clima.yaml` | Sim |
| Plantas do catálogo, fases, Kc e ligação com o ZARC | `regras/plantas.yaml` e `regras/culturas.yaml` | Sim |
| Como o agente fala e o que ele faz | `perfil.yaml` (identidade) e `skills/clima-lavoura/SKILL.md` | Sim |
| As imagens que o bot manda | `layouts/` (HTML + CSS) | Sim |

As regras são relidas quando o arquivo muda: o próximo ciclo já usa o valor novo, sem reiniciar.

**Para mudar mais que o `.env` sem perder nada ao atualizar,** faça um *fork* deste repositório no GitHub e instale do
seu fork (`npm run perfil -- instalar seu-usuario/agrominds`). Assim as suas mudanças ficam versionadas e você traz
as novidades do grupo quando quiser. Outra opção: clone a fita com `git clone` direto dentro de `perfis/`; nesse
caso, `atualizar` faz um `git pull` e não apaga o que você mudou.

## Atualizar

```bash
npm run perfil -- atualizar agrominds
```

Busca a versão nova no GitHub e pede de novo a confirmação do código. **Mantém o `.env` e os dados** (lugares,
plantas, histórico), mas **troca todos os outros arquivos** da fita: mudanças feitas direto em `regras/`, `skills/`,
`layouts/` ou no `perfil.yaml` se perdem (veja a seção anterior). Depois, desligue e ligue a fita.

## O que faz

- **No Telegram** (bot da fita):
  - `/start` pede a localização de **onde fica a plantação** (não precisa estar lá: no 📎 → Localização dá para arrastar o
    mapa); a pessoa pode ter **vários lugares** (fazenda, sítio, horta de casa: `/lugares`, `/renomear`), e em cada um
    escolhe **quantas plantas quiser**, da lavoura ou da horta, diz quando plantou e se irriga;
  - **tudo o que tem dados vai como imagem** (o "print" de um layout em HTML), com uma legenda curta:
    - `/clima` e o **boletim** dos horários escolhidos: agora, próximos dias, gráfico de 24 h, avisos e recomendações;
    - `/previsao`: o período que a pessoa escolher (hoje, amanhã, fim de semana, 3, 7 ou 14 dias);
    - `/plantas`: cada planta com a fase, a colheita estimada e a janela de plantio;
    - `/calendario` e `/plantar`: a **época de plantio no município**, pelo zoneamento oficial, **quando colhe** e quanto
      tempo leva, e o que dá para plantar agora (`/calendario uva, café` mostra só essas; todo mês, junto do primeiro
      boletim, vai a sugestão do mês);
    - a **água da semana** de cada planta: quanto ela deve usar (previsão × fase) e quanto a chuva cobre;
    - **alertas** de geada, calor, chuva forte, vento e doença fúngica;
  - recomendações: janela de pulverização, irrigar ou esperar a chuva (balanço de água), colheita, plantio;
  - **chuva hora a hora** até 7 dias ("que horas chove nesta semana?") e **radar** ("a chuva está vindo?"): se está
    chovendo no lugar, a chuva mais perto, para onde ela anda e a que horas deve chegar (até 3 h);
  - **mensagens automáticas** pedidas na conversa ("me mande o tempo todo dia às 6h", "pare de mandar");
  - conversa livre ("vai chover no fim de semana?", "o que planto agora na horta?", "plantei milho dia 10"): o agente
    usa as ferramentas da fita, e os números (e a imagem) vêm delas;
  - `/esquecer` apaga o lugar, as plantas, as preferências e as mensagens da pessoa.
- **No chat web** do K7: o botão 📍 ao lado da caixa de mensagem cadastra e troca os lugares (onde estou agora, ou
  cidade, endereço ou coordenada colada do Google Maps); o resto é conversa ("como está o tempo no sítio?").
- **Painel administrativo** (Angular, `http://127.0.0.1:8790`): usuários (convite com QR, aprovar, bloquear), as
  plantas de cada pessoa, as imagens que ela recebe (para baixar), tudo o que foi enviado, gráficos do tempo e mapa.

Ferramentas do agente: `clima_lavoura`, `previsao_periodo`, `chuva_por_hora`, `radar_chuva`, `epoca_de_plantio`,
`minhas_plantas`, `balanco_agua`, `definir_planta`, `meus_lugares` e `avisos_automaticos`.

## De onde vêm os dados

- **Tempo:** [Open-Meteo](https://open-meteo.com) (gratuito, sem chave, uso não comercial, CC BY 4.0): estimativa de
  modelos meteorológicos para o ponto, não medição no local; previsão de até 16 dias (além de 7, só tendência).
- **Radar:** [RainViewer](https://www.rainviewer.com/api.html) (gratuito, sem chave, uso pessoal e educativo): imagens
  dos radares meteorológicos dos últimos 2 h. A chegada da chuva é estimada pela própria fita, comparando a imagem de
  agora com a de ~30 min antes. Nem todo lugar tem radar por perto (parte do Centro-Oeste não tem): a fita avisa. A
  coordenada da pessoa não sai do servidor: a fita baixa quadros inteiros do mapa (~300 km) e faz as contas aqui.
- **Época de plantio:** [ZARC — Zoneamento Agrícola de Risco Climático](https://dados.agricultura.gov.br/dataset/tabua-de-risco-zoneamento-agricola-de-risco-climatico)
  (MAPA/Embrapa), por município, do portal de dados abertos. A fita baixa a tábua da safra e a de perenes/olerícolas
  uma vez por safra e guarda só as culturas do catálogo (~25 MB). O ZARC não zoneia folhosas e temperos da horta
  (alface, couve, cebolinha...): para essas, o bot diz que não há calendário oficial, sem inventar meses.
- **Nome da cidade:** [OpenStreetMap/Nominatim](https://nominatim.org) (`AGRO_GEOCODIFICAR=off` desliga).
- **Regras agronômicas** em [regras/](regras/) (YAML, revisáveis sem programar). **São valores de referência a
  validar com um(a) agrônomo(a)** (limites dos alertas, Kc das fases e o ciclo médio usado para estimar a colheita);
  enquanto não forem revisadas, as mensagens saem marcadas "(regra em revisão)". O bot nunca indica defensivo nem dose.

## Testes

Na pasta do K7:

```bash
npm run fita -- agrominds testes    # regras, plantas e ZARC, radar, conversa, notificações, layouts, painel
```

## Arquivos

- `perfil.yaml`: identidade, módulos, canais, quem pode usar o bot e a extensão.
- `extensao/`: o código da fita (tempo, radar, ZARC, regras, Telegram, notificações, ferramentas, imagens, API do
  painel). O K7 carrega este código quando a fita toca; outras fitas não carregam nada disso.
- `layouts/`: as imagens que o bot manda, em HTML + CSS (abra no navegador para ver com os dados de exemplo; edite e o
  próximo envio já sai com o layout novo).
- `regras/`: `clima.yaml` (alertas e recomendações), `culturas.yaml` (fases e Kc) e `plantas.yaml` (o catálogo e a
  ligação de cada planta com o ZARC).
- `admin/`: o painel em Angular (veja [admin/README.md](admin/README.md)).
- `skills/clima-lavoura/`: como o agente responde perguntas de tempo, plantio e manejo.
- `web/`: o botão 📍 do chat web.
- `testes/`: os testes da fita.
- `specs/`: propostas para o grupo revisar.
- `.env`: segredos, fora do Git (modelo em `.env.example`).
