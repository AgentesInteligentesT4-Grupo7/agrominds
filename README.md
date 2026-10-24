# 🌱 AgroMinds — fita do K7

Assistente de IA para o agronegócio do **Grupo 7** (Agentes Inteligentes T4), como fita do
tocador [K7](https://github.com/AgentesInteligentesT4-Grupo7/K7). A fita não tem código: só identidade,
módulos, skills e configuração.

## Rodar

No `.env` do K7, aponte `PERFIS_DIR` para a pasta que contém esta fita e rode:

```bash
npm run chat -- --perfil agrominds   # terminal
npm run web -- --perfil agrominds    # chat no navegador
```

Para usar no Telegram, crie um bot próprio no @BotFather, copie `.env.example` para `.env`, preencha o token
e acrescente `telegram` em `canais` no `perfil.yaml`.

## Foco no agro (a definir pelo grupo)

Ideias levantadas, cada uma vira skills ou ferramentas desta fita:

- **Pragas por foto:** o produtor manda a foto da folha e o agente aponta a provável praga ou doença e o manejo
  (módulo `anexos`, com visão do modelo local).
- **Clima da lavoura:** previsão para a região da fazenda e alertas para plantio, pulverização e colheita
  (módulo `http`, com uma API de previsão em `ferramentas/`).
- **Cotações:** preço de soja, milho, boi, café (módulo `pesquisa-web` ou `http`).
- **Base técnica:** respostas com base em manuais técnicos colocados em `conhecimento/` (módulo `conhecimento`).

## Arquivos

- `perfil.yaml`: identidade, módulos, canais e privacidade (`local`: só modelos na própria GPU).
- `skills/`: skills próprias (sobrescrevem as dos módulos com o mesmo nome).
- `ferramentas/`: ferramentas HTTP declarativas (`exemplo.yaml.off` mostra o formato).
- `.env`: segredos, fora do Git.
