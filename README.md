# 🌱 AgroMinds — fita do K7

Tempo e época de plantio pelo Telegram para **quem planta em qualquer escala** (roça, sítio, horta, quintal ou vaso em
casa), do **Grupo 7** (Agentes Inteligentes T4), como fita do tocador [K7](https://github.com/AgentesInteligentesT4-Grupo7/K7).
Proposta completa: [specs/alertas-clima.md](specs/alertas-clima.md).

## O que faz

- **No Telegram** (bot da fita, só para convidados):
  - `/start` pede a localização de **onde fica a plantação** (não precisa estar lá: no 📎 → Localização dá para arrastar o
    mapa); a pessoa pode ter **vários lugares** (fazenda, sítio, horta de casa: `/lugares`, `/renomear`), e em cada um
    escolhe **quantas plantas quiser**, da lavoura ou da horta, diz quando plantou e se irriga;
  - **tudo o que tem dados vai como imagem** (o "print" de um layout em HTML), com uma legenda curta:
    - `/clima` e o **boletim** dos horários escolhidos: agora, próximos dias, gráfico de 24 h, avisos e recomendações;
    - `/previsao`: o período que a pessoa escolher (hoje, amanhã, fim de semana, 3, 7 ou 14 dias);
    - `/plantas`: cada planta com a fase, a colheita estimada e a janela de plantio;
    - `/calendario` e `/plantar`: a **época de plantio no município**, pelo zoneamento oficial, e o que dá para plantar
      agora (todo mês, junto do primeiro boletim, vai a sugestão do mês);
    - **alertas** de geada, calor, chuva forte, vento e doença fúngica;
  - recomendações: janela de pulverização, irrigar ou esperar a chuva (balanço de água), colheita, plantio;
  - conversa livre ("vai chover no fim de semana?", "o que planto agora na horta?", "plantei milho dia 10"): o agente
    usa as ferramentas da fita, e os números (e a imagem) vêm delas.
- **No chat web** do K7: o botão 📍 ao lado da caixa de mensagem cadastra e troca os lugares (onde estou agora, ou
  cidade, endereço ou coordenada colada do Google Maps); o resto é conversa ("como está o tempo no sítio?").
- **Painel administrativo** (Angular, `http://127.0.0.1:8790`): usuários (convite com QR, aprovar, bloquear), as
  plantas de cada pessoa, as imagens que ela recebe (para baixar), tudo o que foi enviado, gráficos do tempo e mapa.

## De onde vêm os dados

- **Tempo:** [Open-Meteo](https://open-meteo.com) (gratuito, sem chave, uso não comercial, CC BY 4.0): estimativa de
  modelos meteorológicos para o ponto, não medição no local; previsão de até 16 dias (além de 7, só tendência).
- **Época de plantio:** [ZARC — Zoneamento Agrícola de Risco Climático](https://dados.agricultura.gov.br/dataset/tabua-de-risco-zoneamento-agricola-de-risco-climatico)
  (MAPA/Embrapa), por município, do portal de dados abertos. A fita baixa a tábua da safra e a de perenes/olerícolas
  uma vez por safra e guarda só as culturas do catálogo (~25 MB). O ZARC não zoneia folhosas e temperos da horta
  (alface, couve, cebolinha...): para essas, o bot diz que não há calendário oficial, sem inventar meses.
- **Regras agronômicas** em [regras/](regras/) (YAML, revisáveis sem programar). **São valores de referência a
  validar com um(a) agrônomo(a)** (limites dos alertas, Kc das fases e o ciclo médio usado para estimar a colheita);
  enquanto não forem revisadas, as mensagens saem marcadas "(regra em revisão)". O bot nunca indica defensivo nem dose.

## Ligar (na pasta do K7, com `PERFIS_DIR` apontando para a pasta das fitas)

```bash
npm run perfil -- bot agrominds --gerente      # cria o bot da fita (ou --token, colando o do @BotFather)
npm --prefix ../ParreiraClaw-perfis/agrominds/admin ci && npm --prefix ../ParreiraClaw-perfis/agrominds/admin run build
npm run fita -- agrominds admin-criar voce@exemplo.com   # conta do painel (pede a senha)
npm run fita -- agrominds zarc                 # baixa o zoneamento agora (senão, vem na primeira tarefa do dia)
npm run dev -- --perfil agrominds              # liga o bot, os alertas e o painel
```

As imagens usam o **Chrome ou o Edge** já instalados na máquina (nenhum navegador é baixado; outro caminho em
`K7_NAVEGADOR`). Sem navegador, o bot manda o texto.

Ou pela página de administração do K7 (`npm run admin -- --abrir`): aba Telegram para criar o bot e convidar, botão
Ligar para rodar. Convide pessoas com `/convite <nome>` no próprio bot (o QR chega no seu Telegram).

## Testes

```bash
npm run fita -- agrominds testes    # regras, plantas e ZARC, conversa, notificações, layouts (print de verdade), painel
```

## Arquivos

- `perfil.yaml`: identidade, módulos, canais, acesso por convite e a extensão.
- `extensao/`: o código da fita (tempo, ZARC, regras, Telegram, notificações, ferramentas, imagens, API do painel).
- `layouts/`: as imagens que o bot manda, em HTML + CSS (abra no navegador para ver com os dados de exemplo; edite e o
  próximo envio já sai com o layout novo).
- `regras/`: `clima.yaml` (alertas e recomendações), `culturas.yaml` (fases e Kc) e `plantas.yaml` (o catálogo e a
  ligação de cada planta com o ZARC).
- `admin/`: o painel em Angular (veja [admin/README.md](admin/README.md)).
- `skills/clima-lavoura/`: como o agente responde perguntas de tempo, plantio e manejo.
- `specs/`: propostas para o grupo revisar.
- `.env`: segredos, fora do Git (modelo em `.env.example`).
