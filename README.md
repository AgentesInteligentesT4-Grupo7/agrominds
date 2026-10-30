# 🌱 AgroMinds — fita do K7

Alertas de clima para a lavoura pelo Telegram e assistente para o agronegócio, do **Grupo 7** (Agentes
Inteligentes T4), como fita do tocador [K7](https://github.com/AgentesInteligentesT4-Grupo7/K7). Proposta completa:
[specs/alertas-clima.md](specs/alertas-clima.md).

## O que faz

- **No Telegram** (bot próprio da fita, só para convidados):
  - `/start` pede a localização da roça (botão), depois a cultura, a fase e se é irrigada (botões);
  - **boletim** nos horários escolhidos (padrão 6h e 18h), com um **cartão do tempo em imagem**;
  - **alertas** de geada, calor, chuva forte, vento e doença fúngica;
  - **recomendações**: janela de pulverização, irrigar ou esperar a chuva (balanço de água), colheita, plantio;
  - `/clima`, `/lavoura`, `/alertas` (modo e horários), `/pausar`, `/voltar`, `/irriguei`, `/esquecer`;
  - conversa livre ("vai chover amanhã?"): o agente usa as ferramentas de clima, e os números vêm delas.
- **Painel administrativo** (Angular, `http://127.0.0.1:8790`): usuários (convite com QR, aprovar, bloquear),
  tudo o que foi enviado, gráficos do tempo de cada lavoura, mapa e exportação para a apresentação.
- **Dados:** previsão do [Open-Meteo](https://open-meteo.com) (gratuito, sem chave, uso não comercial, CC BY 4.0).
- **Regras agronômicas** em [regras/](regras/) (YAML, revisáveis sem programar). **São valores de referência a
  validar com um(a) agrônomo(a)**; enquanto não forem revisadas, as mensagens saem marcadas "(regra em revisão)".
  O bot nunca indica defensivo nem dose.

## Ligar (na pasta do K7, com `PERFIS_DIR` apontando para a pasta desta fita)

```bash
npm run perfil -- bot agrominds --gerente      # cria o bot da fita (ou --token, colando o do @BotFather)
npm --prefix ../ParreiraClaw-perfis/agrominds/admin ci && npm --prefix ../ParreiraClaw-perfis/agrominds/admin run build
npm run fita -- agrominds admin-criar voce@exemplo.com   # conta do painel (pede a senha)
npm run dev -- --perfil agrominds              # liga o bot, os alertas e o painel
```

Ou pela página de administração do K7 (`npm run admin -- --abrir`): aba Telegram para criar o bot e convidar, botão
Ligar para rodar. Convide pessoas com `/convite <nome>` no próprio bot (o QR chega no seu Telegram).

Também dá para conversar sem Telegram: `npm run chat -- --perfil agrominds` ou `npm run web -- --perfil agrominds`
(as ferramentas de clima pedem a localização, que hoje só chega pelo Telegram).

## Testes

```bash
npm run fita -- agrominds testes    # regras, conversa, notificações, Open-Meteo de mentira, API do painel
```

## Arquivos

- `perfil.yaml`: identidade, módulos, canais, acesso por convite e a extensão.
- `extensao/`: o código da fita (clima, regras, Telegram, notificações, ferramentas, cartão em imagem, API do painel).
- `regras/`: `clima.yaml` (alertas e recomendações) e `culturas.yaml` (fases e Kc).
- `admin/`: o painel em Angular (veja [admin/README.md](admin/README.md)).
- `skills/clima-lavoura/`: como o agente responde perguntas de tempo e manejo.
- `specs/`: propostas para o grupo revisar.
- `.env`: segredos, fora do Git (modelo em `.env.example`).
