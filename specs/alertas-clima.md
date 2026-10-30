# Spec: Alertas de clima para a lavoura pelo Telegram

**Versão:** 0.1 (rascunho para o grupo)
**Status:** Proposta, nada implementado
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

## 3. Non-Goals

- **Receitar defensivo ou dose.** No Brasil, a venda e o uso de agrotóxico exigem receituário agronômico de um
  profissional habilitado. O bot pode **listar produtos registrados no MAPA** para a cultura e a praga (Agrofit),
  sempre com o aviso de procurar um(a) agrônomo(a), nunca indicar qual usar nem quanto.
- Previsão do tempo própria (usamos modelos públicos) e sensores de campo (estação, sonda de solo) nesta versão.
- Uso comercial: o plano gratuito do Open-Meteo é não comercial (ver §9).
- Mapa, painel web e relatórios da safra (podem vir depois).

## 4. Experiência no Telegram

### 4.1 Cadastro

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
1 a 6 h, então consultar mais vezes não traz dado novo (§9).

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
| `k7.dados` (chave/valor por usuário, no SQLite do perfil) | Guardar lugares, lavouras e preferências sem a fita depender de pacote de banco. |

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
│   ├── Notificador.ts     modos de envio, horários, silêncio, sem repetição
│   └── k7.ts              tipos da API do tocador
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

## 8. Requisitos funcionais

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

## 9. Limites, custos e privacidade

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
- **Quem pode usar o bot:** hoje o bot do K7 atende só a lista `TELEGRAM_ALLOWED_USER_IDS`. Para abrir a
  produtores, é preciso um modo público no canal Telegram (com limite de uso por pessoa, como já existe no chat web).

## 10. Edge cases

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

## 11. Métricas

- % de alertas de geada e chuva forte que se confirmaram (comparar com o dado observado do dia seguinte via
  `past_days`).
- Notificações por usuário por dia (meta: no máximo 3 no modo boletim).
- Usuários que pausam ou saem depois de uma semana (excesso de mensagens).
- Chamadas por dia ao Open-Meteo e à Embrapa (longe dos limites).

## 12. Fases

1. **Tocador:** pré-requisitos da §7.1 (localização, comandos e botões, `notificar`, `tarefa`, `dados`).
2. **Clima básico:** cadastro do lugar, `/clima`, boletim diário, cache do Open-Meteo.
3. **Lavoura e alertas:** cadastro de lavouras, motor de regras e regras iniciais, modos de envio, sem repetição,
   silêncio.
4. **Água e pragas:** balanço hídrico, `/pragas` com Agrofit e Bioinsumos.
5. **Extras:** `/plantio` (Agritec), avisos do INMET, conferência das previsões (métricas).

## 13. Perguntas para o grupo

1. Quais culturas e região priorizar (as regras e o Kc começam por elas)?
2. Quem do grupo (ou de fora) revisa as regras agronômicas e assina o `revisado_por`?
3. O bot será aberto a produtores (modo público com limites) ou só para o grupo testar?
4. Vale pagar o Agritec, ou a época de plantio fica como demonstração?

## Referências

- Open-Meteo, documentação da Forecast API: https://open-meteo.com/en/docs
- Open-Meteo, planos e limites: https://open-meteo.com/en/pricing
- Embrapa AgroAPI, primeiros passos: https://www.agroapi.cnptia.embrapa.br/portal/assets/docs/agroapi-primeiros-passos.pdf
- Embrapa AgroAPI, Agrofit: https://www.agroapi.cnptia.embrapa.br/portal/assets/docs/agrofit.pdf
- Embrapa AgroAPI, Agritec: https://www.agroapi.cnptia.embrapa.br/portal/assets/docs/agritec.pdf
- Embrapa AgroAPI, Bioinsumos: https://www.agroapi.cnptia.embrapa.br/portal/assets/docs/bioinsumos.pdf
- OMM, registro das autoridades de alerta (feed CAP do INMET): https://alertingauthority.wmo.int/authorities.php?recId=22
- FAO-56 (evapotranspiração e coeficientes de cultura Kc): Allen et al., *Crop evapotranspiration*, FAO Irrigation
  and Drainage Paper 56, 1998.
