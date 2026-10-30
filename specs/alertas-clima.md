# Spec: Alertas de clima para a lavoura pelo Telegram

**Versão:** 0.3 (0.2 acrescentou o painel em Angular; 0.3, o público amplo, várias plantas, o ZARC e as imagens: §15)
**Status:** Implementada em parte (30/10/2026):
- **Feito:** pré-requisitos no tocador (§7.1); clima; várias plantas por pessoa (lavoura e horta); época de plantio
  por município pelo ZARC; previsão por período (até 14 dias); tudo em imagem (layouts HTML); regras, modos de envio,
  sem repetição e silêncio; balanço hídrico; painel Angular com usuários, plantas, imagens, envios e gráficos.
- **Falta:** Agrofit e Bioinsumos (precisam das chaves da Embrapa); avisos do INMET; calendário oficial para as
  hortaliças que o ZARC não zoneia; validação das regras e dos ciclos por agrônomo(a).
**Autor:** Grupo 7 (rascunho: K7 Agent)
**Data:** 2026-10-30
**Reviewers:** Parreira, Grupo 7 e, para as regras agronômicas, um(a) agrônomo(a)

---

## 1. Resumo

O produtor manda a **localização** no Telegram, diz **o que planta** (cultura e fase) e passa a receber no celular:

- um **boletim** do tempo nos horários que escolher (ex.: 6h e 18h);
- **alertas** quando o tempo previsto afeta a lavoura (geada, calor, chuva forte, vento, risco de doença);
- **recomendações de manejo** ligadas ao tempo: hora boa para pulverizar, irrigar ou esperar a chuva, janela para colher;
- **resposta na hora** quando pedir ("e o tempo amanhã?", "dá para pulverizar hoje à tarde?").

Um **painel administrativo web (Angular)** controla quem pode usar o bot (convites e pedidos de acesso, sem lista de
IDs no `.env`), mostra **tudo o que foi enviado** a cada usuário e traz **gráficos do tempo** de cada lugar (previsão,
ocorrido, balanço hídrico, alertas), úteis também para apresentar o trabalho.

Os números vêm de APIs gratuitas (Open-Meteo para o tempo; Embrapa AgroAPI para pragas, produtos registrados e
época de plantio). As decisões agronômicas vêm de **regras escritas em YAML na fita**, que o grupo e um(a)
agrônomo(a) podem revisar sem programar. O modelo de linguagem só **explica** o que as regras e os dados dizem, em
português simples: nunca inventa número, dose ou previsão (instrução que a fita AgroMinds já tem).

## 2. Goals

- G-01: cadastro em menos de 1 minuto no Telegram: botão "📍 Enviar localização" + escolher a cultura.
- G-02: alerta de risco (ex.: geada) chega com pelo menos 12 h de antecedência quando a previsão permite.
- G-03: nenhuma notificação repetida para o mesmo risco no mesmo dia; nada entre 22h e 6h, salvo alerta grave.
- G-04: cada recomendação diz **por quê** (o dado e a regra) e de onde veio o dado.
- G-05: custo zero no uso acadêmico (dentro dos limites gratuitos das APIs).
- G-06: o que é genérico (receber localização, mandar mensagem sem ser resposta, tarefas agendadas) fica no
  tocador K7 para qualquer fita usar; o que é de clima e lavoura fica nesta fita.
- G-07: liberar ou bloquear um usuário pelo painel em menos de 30 segundos, sem editar arquivo nem reiniciar o bot.
- G-08: para qualquer usuário, ver em uma tela o que ele recebeu, por quê (regra e dado) e o tempo do lugar dele.

## 3. Non-Goals

- **Receitar defensivo ou dose.** No Brasil, a venda e o uso de agrotóxico exigem receituário agronômico de um
  profissional habilitado. O bot pode **listar produtos registrados no MAPA** para a cultura e a praga (Agrofit),
  sempre com o aviso de procurar um(a) agrônomo(a), nunca indicar qual usar nem quanto.
- Previsão do tempo própria (usamos modelos públicos) e sensores de campo (estação, sonda de solo) nesta versão.
- Uso comercial: o plano gratuito do Open-Meteo é não comercial (ver §10).
- Mapa, painel web e relatórios da safra (podem vir depois).

## 4. Experiência no Telegram

### 4.1 Cadastro

Só usa o bot quem foi liberado no painel (§8.2): pelo **link de convite** (`https://t.me/<bot>?start=<código>`, que já
vincula a conta) ou por **pedido de acesso** (quem não está cadastrado manda `/start`, recebe "seu pedido foi
enviado" e espera a aprovação). Liberado, o cadastro da lavoura segue assim:

```
Usuário: /start
Bot:     🌱 Oi! Eu aviso sobre o tempo na sua lavoura. Toque no botão para mandar a localização da roça.
         [📍 Enviar localização]          ← botão do Telegram (request_location, só em conversa privada)
Usuário: (manda a localização)
Bot:     📍 Recebi: perto de <município>/<UF>. O que você planta aí?
         [Soja] [Milho] [Feijão] [Café] [Hortaliças] [Pastagem] [Outra…]
Usuário: Soja
Bot:     Em que fase está? [Preparando o plantio] [Plantada/emergência] [Crescendo] [Florindo]
         [Enchendo grão] [Perto da colheita]   — e é irrigada? [Sim] [Não]
Bot:     ✅ Pronto! Mando o boletim às 6h e às 18h e aviso na hora se aparecer risco.
         Mude quando quiser: /alertas · /lavoura · /clima
```

Também vale mandar a localização a qualquer momento (troca o lugar) ou digitar o município ("Rio Verde, GO"),
resolvido por geocodificação.

### 4.2 Comandos

| Comando | O que faz |
|---|---|
| `/clima` | Agora + próximas 24 h + 7 dias, com as recomendações do momento. |
| `/lavoura` | Ver e mudar cultura, fase, irrigada, data de plantio; várias lavouras/talhões no mesmo lugar ou em lugares diferentes. |
| `/alertas` | Modo de envio (§4.3), horários do boletim, horário de silêncio, quais alertas receber. |
| `/pausar` · `/voltar` | Para e retoma as notificações (ex.: entressafra). |
| `/pragas` | Pragas e doenças de atenção para a cultura agora e produtos registrados no MAPA (Agrofit), com o aviso do receituário. |
| `/plantio` | Janela de plantio de menor risco no município (ZARC/Agritec; ver §6.3). |
| `/esquecer` | Apaga localização, lavouras e preferências (LGPD). |

Fora dos comandos, a conversa livre continua: "vai chover amanhã?", "posso pulverizar hoje às 16h?" — o agente
usa as ferramentas da §7 e responde com os dados.

### 4.3 Modos de envio (escolha do usuário)

| Modo | Como funciona |
|---|---|
| **Boletim** (padrão) | Um resumo nos horários escolhidos (padrão 6h e 18h). |
| **De hora em hora** | A cada 1 h confere a previsão e **só manda se algo mudou** (novo risco, chuva que entrou ou saiu da previsão). |
| **Só alertas** | Nada de boletim; só quando uma regra de risco disparar. |
| **Só quando eu pedir** | Nenhuma notificação; usa `/clima` e a conversa. |

"Tempo real" na prática é a checagem de hora em hora: os modelos globais que cobrem o Brasil são atualizados a cada
1 a 6 h, então consultar mais vezes não traz dado novo (§10).

### 4.4 Exemplo de mensagem

```
🌤️ Boletim das 6h — <apelido do lugar> (soja, floração)

Hoje: 19° → 33°, sol entre nuvens, chuva 10% · vento 8 km/h
Amanhã: 21° → 29°, chuva 80% (≈ 18 mm à tarde)

✅ Pulverização: boa janela hoje das 6h às 10h (vento fraco, umidade acima de 55%, sem chuva nas próximas horas).
💧 Irrigação: pode esperar — a chuva de amanhã deve repor o que a lavoura perde hoje (≈ 6 mm).
⚠️ Doença: umidade alta e calor previstos nos próximos 3 dias favorecem fungos. Vale vistoriar a lavoura.

Dados: Open-Meteo.com · regras revisadas por <responsável> · /clima para detalhes
```

## 5. Fontes de dados

### 5.1 Tempo: Open-Meteo (principal)

- Endpoint: `GET https://api.open-meteo.com/v1/forecast`, sem chave no plano gratuito.
- Parâmetros: `latitude`, `longitude`, `timezone=auto`, `forecast_days` (até 16), `past_days` (até 92, usado no
  balanço hídrico), `current`, `hourly`, `daily`, `models` (padrão `auto`: no Brasil usa os globais ICON, GFS e
  ECMWF IFS, 9 a 25 km).
- Variáveis horárias: `temperature_2m`, `relative_humidity_2m`, `dew_point_2m`, `precipitation`,
  `precipitation_probability`, `weather_code`, `cloud_cover`, `wind_speed_10m`, `wind_gusts_10m`,
  `wind_direction_10m`, `shortwave_radiation`, `et0_fao_evapotranspiration`, `vapour_pressure_deficit`, `uv_index`,
  `soil_temperature_0cm`/`6cm`/`18cm`, `soil_moisture_0_to_1cm` … `soil_moisture_27_to_81cm`, `is_day`.
- Diárias: `temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`, `precipitation_probability_max`,
  `et0_fao_evapotranspiration`, `wind_speed_10m_max`, `wind_gusts_10m_max`, `sunrise`, `sunset`.
- `current` aceita as mesmas variáveis horárias.
- Limites gratuitos: 600/min, 5.000/h, **10.000/dia**, 300.000/mês; pedido com mais de 10 variáveis conta como
  mais de uma chamada. **Uso não comercial**; dados sob **CC BY 4.0** (citar "Open-Meteo.com" nas mensagens).
- Observações: umidade e temperatura do solo são **saídas de modelo**, não medição; `et0` assume solo sem limite
  de água (FAO-56 Penman-Monteith), que é o que o balanço hídrico precisa.

### 5.2 Avisos oficiais: INMET (fase 4, opcional)

Feed de alertas no padrão CAP (RSS/XML), com a área de cada aviso (polígono). Endereço listado pela OMM:
`https://alert-as.inmet.gov.br/cap_12/rss/alert-as.rss` (**confirmar** antes de usar). Quando o ponto da lavoura
cai dentro do polígono, o aviso oficial vai junto (ex.: tempestade, onda de calor), com a fonte.

### 5.3 Embrapa AgroAPI (fase 3)

Acesso: conta na loja `https://www.agroapi.cnptia.embrapa.br/store/`, criar uma aplicação, assinar a API e gerar
**Consumer Key/Secret**. Token por OAuth2: `POST https://api.cnptia.embrapa.br/token` com
`grant_type=client_credentials` e `Authorization: Basic <base64(key:secret)>`; validade padrão de 1 h (renovar
automaticamente). Chaves só no `.env` da fita.

| API | O que dá | Plano gratuito | Uso aqui |
|---|---|---|---|
| **Agrofit** | Produtos registrados no MAPA (defensivos, bioinsumos) com busca por **praga, cultura**, ingrediente ativo, classificação toxicológica e ambiental; listas de pragas, plantas daninhas e culturas | **100 mil requisições/mês** (contínuo) | `/pragas` e a ferramenta `produtos_registrados` (sempre com o aviso do receituário) |
| **Bioinsumos** | Produtos biológicos (controle de pragas, inoculantes) | 100 mil/mês | Opção "alternativas biológicas" no `/pragas` |
| **Agritec** | `/zoneamento` (janela de plantio do ZARC por `idCultura` + `codigoIBGE`, risco 20/30/40%), `/cultivares` (por cultura e UF), `/adubacao/recomendacao`, `/produtividade` (com balanço hídrico) | **Só 1 mês ou 1.000 requisições**; depois R$ 250/mês por 10 mil | `/plantio`, só se o grupo contratar ou para demonstração; resultados guardados em cache por safra |
| ClimAPI | Previsão climática da Embrapa | 1 mês/1.000; depois pago | Não usar: o Open-Meteo cobre isso de graça |

Base das URLs: `https://api.cnptia.embrapa.br/<api>/v1` (ex.: `…/agritec/v1/culturas`, confirmado; para o
Agrofit, conferir o caminho exato no *API Console* da loja).

### 5.4 Localização para município (Agritec, mensagens)

- Município e UF a partir da coordenada: geocodificação reversa (ex.: Nominatim/OpenStreetMap, 1 pedido por
  segundo, com identificação do app; feito **uma vez** por localização e guardado).
- Código IBGE do município: API de localidades do IBGE
  (`https://servicodados.ibge.gov.br/api/v1/localidades/...`, gratuita; confirmar o caminho), também guardado.

## 6. Regras agronômicas

### 6.1 Formato (dados, não código)

As regras ficam em `regras/clima.yaml` na fita. O motor só **lê** e avalia; mudar um limite não exige programar.
Cada regra tem fonte e quem revisou.

```yaml
- id: geada
  titulo: Risco de geada
  culturas: todas            # ou [soja, milho, cafe]
  fases: todas               # ou [emergencia, florescimento]
  quando:                    # todas as condições (e); use "qualquer:" para "ou"
    - { variavel: temperature_2m, agregacao: minimo, janela: proximas_36h, operador: "<=", valor: 3 }
  severidade: grave          # info | atencao | grave (grave ignora o horário de silêncio)
  mensagem: >
    🥶 Risco de geada na madrugada de {dia}: mínima prevista de {valor}°C.
    Lavouras jovens e baixadas são as mais afetadas.
  fonte: "Referência inicial: temperatura de abrigo ≤ 3 °C costuma indicar geada na relva"
  revisado_por: null         # nome de quem validou; sem revisão, a mensagem sai com "(regra em revisão)"
```

Agregações: `minimo`, `maximo`, `soma`, `media`, `horas_em_que` (conta horas que atendem a condição, ex.: horas
com UR ≥ 90%). Janelas: `agora`, `proximas_Nh`, `hoje`, `amanha`, `ultimos_Nd`. Variáveis derivadas calculadas pelo
motor: `delta_t` (temperatura menos bulbo úmido), `deficit_hidrico` (§6.3), `horas_molhamento` (UR ≥ 90% ou chuva).

### 6.2 Regras iniciais (valores de referência, **a validar com agrônomo(a)**)

| Regra | Condição inicial | Mensagem (resumo) |
|---|---|---|
| Geada | Mínima ≤ 3 °C nas próximas 36 h (grave se ≤ 1 °C) | Risco de geada; proteger mudas, evitar irrigar à noite em baixadas |
| Calor | Máxima ≥ 35 °C; peso maior em florescimento/enchimento de grão | Estresse térmico; atenção à água |
| Chuva forte | ≥ 20 mm em 1 h ou ≥ 50 mm em 24 h | Adiar adubação/aplicação; risco de erosão e enxurrada |
| Vento forte | Rajadas ≥ 50 km/h | Risco de acamamento; não pulverizar |
| Janela de pulverização | Vento entre 3 e 10 km/h, temperatura < 30 °C, UR > 55%, `delta_t` entre 2 e 8, sem chuva nas próximas 2 h | "Boa janela das X às Y" (ou "hoje não tem janela boa") |
| Irrigação | Déficit hídrico > limite da cultura **e** chuva prevista nos próximos 2 dias < déficit | "Vale irrigar, de preferência cedo ou no fim da tarde" ou "pode esperar a chuva" |
| Doença fúngica | ≥ 10 horas de molhamento/dia com 18 a 28 °C por 2 dias ou mais | Ambiente favorável a fungos: vistoriar a lavoura (sem indicar produto) |
| Ar seco | VPD > 1,6 kPa à tarde (ar muito seco, planta perde muita água) | Atenção à água; evitar pulverizar nesse horário |
| Colheita | ≥ 3 dias seguidos com chuva < 1 mm e UR mínima < 60%, fase "perto da colheita" | Boa janela para colher/secar |
| Plantio | Fase "preparando o plantio", solo úmido (`soil_moisture_9_to_27cm`) e chuva regular prevista; dentro da janela ZARC se houver | Condição favorável à semeadura |

### 6.3 Balanço hídrico (irrigação)

Diário, por lavoura: `déficit = Σ (ET0 × Kc) − Σ chuva efetiva` nos últimos dias (usando `past_days` do
Open-Meteo), zerando quando há chuva ou irrigação suficiente (o usuário pode informar "irriguei" para zerar).
**Kc** por cultura e fase vem de uma tabela da fita (`regras/kc.yaml`, valores da FAO-56; ex.: soja ≈ 0,4 no início,
≈ 1,15 no florescimento/enchimento, ≈ 0,5 no fim). O limite para avisar sai da capacidade de água do solo (CAD), com
um padrão por tipo de solo, ajustável pelo usuário. Assim a recomendação de regar depende de quanta água a lavoura
perdeu e de quanta chuva vem, e não só de fazer sol.

### 6.4 Pragas e doenças

- O **clima indica risco** (regras de molhamento, calor e umidade).
- O **Agrofit diz o que existe registrado** para aquela cultura e praga.
- O bot mostra: "ambiente favorável a <doença>; vistorie; produtos registrados no MAPA para <cultura> e <praga>:
  <lista resumida>; **a escolha e a dose exigem receituário agronômico**".
- Lista inicial de pragas e doenças por cultura e as condições que as favorecem: `regras/pragas.yaml`, preenchida e
  revisada pelo grupo com fontes da Embrapa.

## 7. Arquitetura

### 7.1 No tocador K7 (genérico, para qualquer fita): pré-requisitos

A API de extensão (`src/fitas/FitaApi.ts`) ganha:

| Novo na API `k7` | Para quê |
|---|---|
| `k7.telegram.aoLocalizacao(fn)` | Recebe `message.location` (e local em tempo real) com `userId`, `chatId`, `lat`, `lon`. Hoje o bot recusa como "não suportado". |
| `k7.telegram.pedirLocalizacao(texto)` | Teclado com o botão "📍 Enviar localização" (`request_location`). |
| `k7.telegram.comando(nome, descrição, fn)` | Comandos do bot (`/clima`, `/lavoura`…), que entram no menu do Telegram. |
| `k7.telegram.botoes(prefixo, fn)` | Botões inline (escolher cultura, fase, modo) com `callback_data` prefixado pela fita. |
| `k7.notificar(userId, { texto, botoes? })` | Mandar mensagem **sem ser resposta** (boletim, alerta), pelo canal onde a pessoa está. |
| `k7.tarefa(nome, intervalo, fn)` | Tarefa periódica que roda **só no processo principal** (o bot), nunca duplicada pelo chat web ou terminal. |
| `k7.dados` (chave/valor por usuário, no SQLite do perfil) | Guardar preferências simples sem a fita depender de pacote de banco. |
| `k7.sql` (banco SQLite próprio da fita, em `dados/<fita>/`) | Tabelas da fita (usuários, envios, séries do tempo) com o `better-sqlite3` do tocador, sem `node_modules` na fita. |
| `k7.telegram.autorizar(fn)` | A fita decide quem pode usar o bot (cadastro do painel). Com ele, `TELEGRAM_ALLOWED_USER_IDS` não é exigido; quem não está liberado recebe a mensagem que a fita definir. |
| `k7.telegram.aoIniciarConversa(fn)` | Recebe o `/start <código>` (link de convite) antes da recusa, para vincular a conta. |
| `k7.processoPrincipal` | `true` só no processo do bot: a fita sobe ali o servidor do painel e as tarefas, sem duplicar no chat web ou no terminal. |
| Registro de envios | Cada `k7.notificar` e cada resposta da fita devolvem `{ entregue, erro }` (ex.: "usuário bloqueou o bot"), para o painel mostrar a situação. |

Tudo isso com testes no tocador e documentado no guia de fitas (seção 12).

### 7.2 Na fita AgroMinds

```
agrominds/
├── perfil.yaml            + canais: telegram; + extensao: extensao/index.ts
├── extensao/
│   ├── index.ts           ativar(k7): comandos, botões, localização, tarefa horária, ferramentas
│   ├── OpenMeteo.ts       cliente + cache por célula de grade e hora
│   ├── Embrapa.ts         token OAuth2 + Agrofit/Bioinsumos/Agritec
│   ├── Lugares.ts         localização → município/UF/IBGE (com cache)
│   ├── Regras.ts          leitura dos YAML e avaliação das condições (sem eval)
│   ├── Balanco.ts         balanço hídrico (ET0 × Kc − chuva)
│   ├── Notificador.ts     modos de envio, horários, silêncio, sem repetição; grava cada envio
│   ├── Banco.ts           tabelas e consultas (k7.sql), retenção dos dados antigos
│   ├── Acesso.ts          usuários, convites, pedidos (k7.telegram.autorizar)
│   ├── Painel.ts          servidor do painel: API REST /api/admin + arquivos do Angular (admin/dist)
│   └── k7.ts              tipos da API do tocador
├── admin/                 painel em Angular (projeto próprio: package.json, src/; o build vai para admin/dist)
├── regras/                clima.yaml, kc.yaml, pragas.yaml (revisáveis sem programar)
├── skills/clima-lavoura/  SKILL.md: como responder perguntas de tempo e manejo usando as ferramentas
└── testes/                regras, balanço, notificador e clientes (APIs de mentira)
```

**Ferramentas para o agente** (conversa livre): `clima_agora`, `previsao` (horas/dias), `avaliar_lavoura` (roda
as regras e devolve riscos e janelas), `janela_pulverizacao`, `balanco_hidrico`, `produtos_registrados` (Agrofit),
`epoca_plantio` (Agritec). O agente só repete números que vieram delas.

### 7.3 Ciclo da tarefa horária

1. Agrupa os lugares por célula de grade (coordenada arredondada para 0,1°, cerca de 11 km) e busca a previsão
   **uma vez por célula por hora** (cache), respeitando os limites do Open-Meteo.
2. Para cada lavoura: calcula as derivadas (`delta_t`, molhamento, déficit) e avalia as regras.
3. Compara com o que já foi avisado (chave `regra + dia + lavoura`): só manda o que é **novo ou mudou de
   severidade**.
4. Respeita o modo do usuário (§4.3), o horário de silêncio (22h às 6h, exceto `grave`) e junta tudo numa
   mensagem só.
5. Nos horários de boletim, monta o resumo do dia com as recomendações.
6. Grava a previsão usada e o que foi enviado (§8.3, §8.4).

## 8. Painel administrativo (web, Angular)

### 8.1 Onde roda e quem acessa

- **Angular na versão estável mais recente** quando a implementação começar (hoje a **v22**, de junho de 2026;
  criar com `npx @angular/cli@latest new admin`). Componentes standalone, signals, o novo controle de fluxo
  (`@if`/`@for`), roteamento com carregamento sob demanda, **Angular Material** e idioma **pt-BR** (datas,
  números, `LOCALE_ID`).
- Gráficos com **ECharts** via **ngx-echarts** (a v22 é a versão para o Angular 22). Mapa com **Leaflet** e mapa
  base do **OpenStreetMap** (gratuito, com crédito na tela).
- O build (`admin/dist`) é servido pela extensão num servidor próprio, **só no processo do bot**
  (`k7.processoPrincipal`): `http://127.0.0.1:8790` (`ADMIN_PORTA`). Por padrão só abre no próprio computador; para
  apresentar de outra máquina da rede, `ADMIN_HOST=0.0.0.0` (sempre com login).
- **Login:** e-mail e senha de administrador. O primeiro é criado com `npm run fita -- agrominds admin-criar`. A senha
  é guardada como hash (scrypt) e a sessão vai em cookie `HttpOnly` + `SameSite=Strict`. As chamadas da API exigem o
  cookie e o cabeçalho `X-Requested-With`. Há limite de tentativas de login.
- **Papéis:** `admin` (tudo) e `leitura` (só vê; bom para apresentar sem risco de mudar algo).
- Sem o build do Angular, o endereço mostra como construir: `npm --prefix admin ci && npm --prefix admin run build`.

### 8.2 Usuários do bot (no lugar do `.env`)

Nesta fita, quem pode usar o bot é decidido pelo cadastro do painel (`k7.telegram.autorizar`), não por
`TELEGRAM_ALLOWED_USER_IDS`.

| Jeito de entrar | Como funciona |
|---|---|
| **Convite** | O admin cadastra (nome, telefone ou observação). O painel gera o link `https://t.me/<bot>?start=<código>` e um **QR code**. Quem abre já fica vinculado. Código de uso único, válido por 7 dias. |
| **Pedido de acesso** | Quem não está cadastrado manda `/start`, recebe "seu pedido foi enviado" e aparece em **Pedidos** com nome e @ do Telegram. Aprovar ou recusar avisa a pessoa no Telegram. |
| **Manual** | Informar o ID numérico do Telegram (para quem já o conhece). |

- **Situação:** pendente, ativo, pausado, bloqueado. Bloquear vale **na hora**: a próxima mensagem já é recusada,
  e as notificações param.
- **Ficha do usuário:** nome, @ do Telegram, desde quando, último contato, lugares (no mapa), lavouras, modo de
  envio e horários. O admin pode corrigir lavoura e modo, e tem o botão **"Enviar boletim de teste agora"**.
- **Excluir** apaga os dados da pessoa (o mesmo que o `/esquecer`), com confirmação.

### 8.3 O que foi enviado

- **Cada envio fica registrado:** data e hora, usuário, tipo (boletim, alerta, resposta ao `/clima`, conversa), regras
  que dispararam e severidade, **texto exato enviado**, situação (entregue, falhou, usuário bloqueou o bot) e o
  resumo dos dados usados (ex.: "mínima prevista 2,1 °C às 5h").
- **Tela "Envios":** tabela com filtros (usuário, tipo, regra, severidade, período), busca no texto e a mensagem
  como aparece no Telegram.
- **Conversa livre:** por padrão o painel mostra só a quantidade de mensagens. Ver o texto exige ligar
  `ADMIN_VER_CONVERSAS=on` e avisar os usuários no `/start` (LGPD).

### 8.4 Dados do tempo e gráficos

A tarefa horária grava, por célula de grade, a **previsão** (próximas 48 h, hora a hora) e o **ocorrido** (a hora que
passou, pelo `current`/`past_days`). Assim dá para comparar o previsto com o que aconteceu.

| Gráfico | O que mostra |
|---|---|
| **Meteograma** do lugar | Temperatura (linha), chuva (barras), chance de chuva, vento e rajadas: últimos 30 dias + próximos 7 |
| **Umidade e VPD** | Umidade relativa e déficit de pressão de vapor, com as faixas de atenção (< 0,4 e > 1,6 kPa) |
| **Balanço hídrico** da lavoura | ET0 × Kc acumulado, chuva, déficit e a linha do limite de irrigação, com os "irriguei" marcados |
| **Janelas de pulverização** | Por dia, faixas de horas boas (verde) e ruins (vermelho), com o motivo ao passar o mouse |
| **Linha do tempo de alertas** | Quando cada regra disparou, por severidade, sobre a curva de temperatura |
| **Previsto × ocorrido** | Chuva e mínimas previstas contra as que aconteceram; acerto dos alertas de geada e chuva forte |

**Painel geral (tela inicial):**
- **Cartões:** usuários ativos, pedidos esperando, envios hoje, alertas da semana por tipo.
- **Mapa** com os lugares, em ponto aproximado e com a cor da severidade atual.
- **Envios por dia** e **alertas por regra**.

**Para a apresentação:**
- Cada gráfico exporta **CSV** e **PNG**.
- O **modo apresentação** abre em tela cheia, só leitura, e passa pelos gráficos de um usuário escolhido.

### 8.5 API do painel (REST, JSON, servida pela extensão)

| Método e caminho | Para quê |
|---|---|
| `POST /api/admin/entrar` · `POST /api/admin/sair` · `GET /api/admin/eu` | Sessão |
| `GET /api/admin/resumo` | Cartões, mapa e totais do painel geral |
| `GET/POST/PATCH/DELETE /api/admin/usuarios[/:id]` | Lista (filtro, busca, paginação), cadastro, mudar situação/lavoura/modo, excluir |
| `POST /api/admin/usuarios/:id/convite` | Gera link e QR code |
| `GET /api/admin/pedidos` · `POST /api/admin/pedidos/:id/aprovar\|recusar` | Pedidos de acesso |
| `POST /api/admin/usuarios/:id/teste` | Envia um boletim de teste |
| `GET /api/admin/envios?usuario&tipo&regra&de&ate&q` | Registro de envios |
| `GET /api/admin/lugares/:id/tempo?de&ate&variaveis` | Séries para os gráficos (previsto e ocorrido) |
| `GET /api/admin/lavouras/:id/balanco?de&ate` | Série do balanço hídrico |
| `GET /api/admin/alertas?de&ate` | Linha do tempo de alertas |
| `GET /api/admin/exportar/:grafico.csv?...` | Exportação |
| `GET/POST /api/admin/administradores` | Contas do painel (só `admin`) |

### 8.6 Armazenamento

Banco SQLite da fita (`dados/agrominds/agrominds.db`, por `k7.sql`), com estas tabelas:
- `usuarios`, `convites`, `pedidos`, `lugares`, `lavouras`, `preferencias`;
- `envios`, `alertas_enviados`;
- `previsoes` (célula, hora da consulta, hora prevista, variáveis) e `ocorrido` (célula, hora, variáveis);
- `administradores`.

Retenção configurável: previsões por 90 dias, ocorrido e envios por 1 ano.

## 9. Requisitos funcionais

| ID | Requisito | Prioridade |
|---|---|---|
| RF-01 | Receber a localização pelo Telegram (botão ou anexo) e por nome de município; guardar coordenada arredondada, município, UF e código IBGE. | Must |
| RF-02 | Cadastrar uma ou mais lavouras por usuário: cultura, fase, irrigada, data de plantio, tipo de solo (opcional). | Must |
| RF-03 | `/clima` com agora, próximas 24 h e 7 dias, e as recomendações do momento. | Must |
| RF-04 | Modos de envio: boletim (horários configuráveis), de hora em hora (só se mudar), só alertas, só quando pedir. | Must |
| RF-05 | Motor de regras lendo `regras/*.yaml`, com agregações e janelas da §6.1, sem executar código do YAML. | Must |
| RF-06 | Regras iniciais da §6.2, marcadas "(regra em revisão)" enquanto `revisado_por` estiver vazio. | Must |
| RF-07 | Sem repetição do mesmo aviso; horário de silêncio; `/pausar` e `/voltar`. | Must |
| RF-08 | Balanço hídrico com ET0 × Kc e chuva (passada e prevista); "irriguei" zera o déficit. | Should |
| RF-09 | `/pragas`: riscos do momento + produtos registrados (Agrofit), sempre com o aviso do receituário. | Should |
| RF-10 | `/plantio` com a janela ZARC (Agritec), em cache por safra; desligado sem chave. | Could |
| RF-11 | Avisos oficiais do INMET (CAP) para o ponto da lavoura. | Could |
| RF-12 | `/esquecer` apaga tudo do usuário; a coordenada nunca vai para o log nem para o modelo de linguagem. | Must |
| RF-13 | Mensagens citam a fonte ("Dados: Open-Meteo.com", "Agrofit/MAPA via Embrapa"). | Must |
| RF-14 | Pré-requisitos genéricos no tocador (§7.1), com testes. | Must |
| RF-15 | Painel em Angular (última versão estável), com login, papéis `admin` e `leitura`, só em 127.0.0.1 por padrão. | Must |
| RF-16 | Acesso ao bot pelo painel: convite (link + QR), pedido de acesso, cadastro manual; bloquear vale na hora; nada de IDs no `.env`. | Must |
| RF-17 | Registro de cada envio (texto, tipo, regras, dados usados, situação) e a tela "Envios" com filtros. | Must |
| RF-18 | Séries do tempo por lugar (previsto e ocorrido) e os gráficos da §8.4. | Should |
| RF-19 | Painel geral com cartões, mapa e totais. | Should |
| RF-20 | Exportar CSV/PNG e modo apresentação. | Could |
| RF-21 | Ver o texto das conversas só com `ADMIN_VER_CONVERSAS=on` e aviso aos usuários. | Should |

## 10. Limites, custos e privacidade

- **Open-Meteo:** com cache por célula de 0,1° e consulta horária, cada célula gasta cerca de 24 chamadas por dia,
  o que dá centenas de lugares dentro do limite de 10.000/dia. Uso **não comercial**: se o projeto virar produto, é
  preciso assinar o plano comercial ou hospedar o Open-Meteo (código aberto, AGPLv3) por conta própria.
- **Atualização dos modelos:** ICON a cada 3 h, GFS a cada 1 h, ECMWF a cada 6 h; no Brasil não há modelo regional
  no Open-Meteo, então a previsão é de 9 a 25 km, boa para tendência e menos precisa para chuva localizada. As
  mensagens devem dizer "previsão" e "chance", nunca certeza.
- **Embrapa:** Agrofit e Bioinsumos cabem no gratuito (100 mil/mês). Agritec gratuito acaba em 1 mês: decidir com o
  grupo se vale contratar ou usar só como demonstração.
- **LGPD:** localização é dado pessoal. Guardar só o necessário (coordenada arredondada), não registrar no log, não
  enviar ao modelo de linguagem (ele recebe o município e os dados do tempo), apagar com `/esquecer`, e explicar
  isso no `/start`.
- **Quem pode usar o bot:** decidido no painel (§8.2), não mais pela lista `TELEGRAM_ALLOWED_USER_IDS`. Mesmo
  liberado, cada pessoa tem limite de mensagens por hora para o agente (protege as chaves dos modelos).
- **Painel e LGPD:** o `/start` explica o que fica guardado (lugar aproximado, lavouras, mensagens enviadas pelo bot)
  e quem vê (os administradores da fita). O painel não mostra a coordenada exata no mapa (ponto aproximado), e a
  exportação não leva nome nem @ do Telegram, a menos que o admin marque essa opção.

## 11. Edge cases

| Caso | Comportamento |
|---|---|
| Open-Meteo fora do ar | Usa o último dado em cache com a hora ("previsão das 14h"); se passar de 6 h, avisa que está sem atualização e não manda alerta novo. |
| Localização no mar ou fora do Brasil | Aceita o tempo, mas desliga Agritec/IBGE e avisa. |
| Cultura sem regras específicas | Só as regras de `culturas: todas` e o aviso "regras gerais". |
| Previsões que mudam (chuva entra e sai) | No modo de hora em hora, avisa a mudança uma vez; não alterna mensagens a cada hora (exige mudança de pelo menos 2 h seguidas). |
| Muitos alertas ao mesmo tempo | Uma mensagem só, ordenada por severidade. |
| Usuário bloqueou o bot | Marca como inativo e para de tentar. |
| Fuso horário | `timezone=auto` pela coordenada; horários do boletim no fuso do lugar. |
| Token da Embrapa expirado | Renova sozinho; se as chaves faltarem, os comandos dizem que a função está desligada. |
| Convite usado por outra pessoa | O código vale uma vez; o painel mostra quem usou e permite desfazer o vínculo. |
| Usuário bloqueado com alertas na fila | Os envios pendentes são descartados e aparecem como "cancelado (bloqueado)". |
| Bot e chat web rodando juntos | Painel e tarefas só no processo do bot (`k7.processoPrincipal`); o outro processo não abre a porta. |
| Painel sem o build do Angular | A página explica como construir; a API continua funcionando. |

## 12. Métricas

- % de alertas de geada e chuva forte que se confirmaram (comparar com o dado observado do dia seguinte via
  `past_days`).
- Notificações por usuário por dia (meta: no máximo 3 no modo boletim).
- Usuários que pausam ou saem depois de uma semana (excesso de mensagens).
- Chamadas por dia ao Open-Meteo e à Embrapa (longe dos limites).
- Tempo entre o pedido de acesso e a aprovação no painel.

## 13. Fases

1. **Tocador:** pré-requisitos da §7.1 (localização, comandos e botões, `notificar`, `tarefa`, `sql`, `autorizar`,
   `processoPrincipal`).
2. **Acesso e clima básico:**
   - painel Angular com login, usuários, convites e pedidos (substitui o `.env`);
   - cadastro do lugar, `/clima`, boletim diário, cache do Open-Meteo;
   - registro de envios.
3. **Lavoura e alertas:**
   - cadastro de lavouras, motor de regras e regras iniciais, modos de envio, sem repetição, silêncio;
   - tela "Envios" completa.
4. **Gráficos:** séries previsto e ocorrido, meteograma, umidade e VPD, alertas, painel geral com mapa.
5. **Água e pragas:** balanço hídrico (com o gráfico), `/pragas` com Agrofit e Bioinsumos.
6. **Extras:**
   - `/plantio` (Agritec) e avisos do INMET;
   - previsto × ocorrido (métricas);
   - exportação e modo apresentação.

## 14. Perguntas para o grupo

1. Quais culturas e região priorizar (as regras e o Kc começam por elas)?
2. Quem do grupo (ou de fora) revisa as regras agronômicas e assina o `revisado_por`?
3. O bot será aberto a produtores ou só para o grupo testar? Isso define quantos convites e o limite por pessoa.
4. Vale pagar o Agritec, ou a época de plantio fica como demonstração?
5. Quem são os administradores do painel e quem fica só com `leitura`?
6. O painel roda só no computador de quem cuida do bot ou vai para um servidor (VPS) durante a apresentação?

## 15. Revisão 0.3: qualquer pessoa, várias plantas, ZARC e imagens

Pedidos do grupo depois da 0.2, já implementados:

- **Público amplo.** Não é só para o produtor grande: quem tem horta, quintal ou vasos usa o mesmo bot. Os textos não
  presumem roça (“Enviar minha localização”, “o que você planta”), e o catálogo tem lavoura **e** horta/pomar.
- **Várias plantas por pessoa.** A localização vem uma vez e fica; a pessoa marca quantas plantas quiser
  (`regras/plantas.yaml`), diz quando plantou (lavoura) ou a fase (perenes) e quais irriga. Com a data de plantio, a
  fase de hoje sai do ciclo médio (referência a revisar). Avisos gerais (geada, chuva, vento) saem uma vez, com a
  severidade mais alta entre as plantas; os de cultura ou fase dizem a que plantas se referem.
- **Época de plantio oficial, por município.** Em vez de meses escritos à mão, a fita usa a **Tábua de risco do ZARC**
  (MAPA/Embrapa), dados abertos, gratuita e sem chave: datas de plantio por município, cultura, solo, ciclo e manejo,
  em decêndios, com o risco (20, 30 ou 40%). Dois arquivos: a safra atual (grãos) e “Perene, Olerícola e Sem Safra”
  (café, cana, frutas, cebola, alho, batata, melancia, mandioca, pastagem). A fita baixa uma vez por safra (perenes:
  uma vez por ano; ~750 MB lidos aos poucos), guarda só as culturas do catálogo (~25 MB: por município, cultura e
  manejo, o menor risco entre ciclos e cultivares em cada classe de solo) e mostra o solo de textura média. O ZARC não
  zoneia folhosas e temperos (alface, couve, cebolinha, coentro, tomate de mesa): para essas, o bot diz que não há
  calendário oficial. A colheita, que o ZARC não traz, só aparece para quem informou a data de plantio (plantio + ciclo
  médio, marcada como estimativa).
- **Tudo em imagem.** Telegram não mostra tabelas nem gráficos: boletim, `/clima`, `/previsao`, `/plantas`,
  `/calendario`, `/plantar` e os alertas vão como o “print” de um layout em HTML (`layouts/`), com uma legenda curta;
  o texto completo fica no histórico do painel e vai no lugar da imagem se ela falhar. O K7 ganhou
  `util.htmlParaPng` (Chrome ou Edge já instalados, via playwright-core, sem rede na página) e `anexarImagem` nas
  ferramentas do agente.
- **Previsão por período.** `/previsao` com botões (hoje, amanhã, fim de semana, 3, 7 ou 14 dias); o Open-Meteo dá
  16 dias (além de 7, tendência). Até 3 dias, gráfico hora a hora; mais, dia a dia.
- **Vários lugares por pessoa.** A localização não precisa ser onde a pessoa está (no Telegram, arrastar o mapa; no chat
  web, buscar cidade, endereço ou coordenada). Cada lugar (fazenda, sítio, horta de casa) tem nome, coordenada e as
  plantas dele; um fica "em uso" para os comandos e as perguntas, e os boletins e alertas saem de todos, com o nome do
  lugar. `/lugares` e `/renomear` no Telegram; botão 📍 no chat web (que não recebe notificações automáticas).
- **Sugestão do mês.** No primeiro boletim de cada mês, vai junto “O que plantar agora” no município (`/plantar`).

Comandos novos: `/previsao`, `/plantas` (substitui `/lavoura`), `/calendario`, `/plantar`. Ferramentas do agente:
`previsao_periodo`, `epoca_de_plantio`, `minhas_plantas`, `definir_planta` (substituem `previsao_dias` e
`definir_lavoura`). Comando de terminal: `npm run fita -- agrominds zarc [--forcar]`.

## Referências

- Open-Meteo, documentação da Forecast API: https://open-meteo.com/en/docs
- Open-Meteo, planos e limites: https://open-meteo.com/en/pricing
- Embrapa AgroAPI, primeiros passos: https://www.agroapi.cnptia.embrapa.br/portal/assets/docs/agroapi-primeiros-passos.pdf
- Embrapa AgroAPI, Agrofit: https://www.agroapi.cnptia.embrapa.br/portal/assets/docs/agrofit.pdf
- Embrapa AgroAPI, Agritec: https://www.agroapi.cnptia.embrapa.br/portal/assets/docs/agritec.pdf
- Embrapa AgroAPI, Bioinsumos: https://www.agroapi.cnptia.embrapa.br/portal/assets/docs/bioinsumos.pdf
- OMM, registro das autoridades de alerta (feed CAP do INMET): https://alertingauthority.wmo.int/authorities.php?recId=22
- Angular, versões e suporte: https://angular.dev/reference/releases
- ngx-echarts (v22 para o Angular 22): https://www.npmjs.com/package/ngx-echarts
- FAO-56 (evapotranspiração e coeficientes de cultura Kc): Allen et al., *Crop evapotranspiration*, FAO Irrigation
  and Drainage Paper 56, 1998.
- ZARC, Tábua de risco (dados abertos do MAPA): https://dados.agricultura.gov.br/dataset/tabua-de-risco-zoneamento-agricola-de-risco-climatico
- ZARC, dicionário de dados da tábua de risco (2026): https://dados.agricultura.gov.br/dataset/6d3d141c-885e-41a4-ab7f-dc8ff323b96f/resource/bebb0ebb-bc75-460c-b900-a7a1ebd87bee/download/dicionario-de-dados-tabua-de-risco-2026.pdf
