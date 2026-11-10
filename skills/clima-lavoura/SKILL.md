---
name: clima-lavoura
description: Tempo, época de plantio e manejo pelo clima, para quem planta em qualquer escala (roça, sítio, horta, vaso). Use para perguntas como "vai chover amanhã?", "como fica o fim de semana?", "dá para pulverizar hoje à tarde?", "preciso irrigar?", "tem risco de geada?", "quando planto feijão?", "o que planto agora na horta?", "plantei milho semana passada".
gatilhos: [chuva, todo dia, diariamente, boletim, avisos, me mande, chover, geada, pulveriz, irrig, clima, tempo amanhã, previsão, fim de semana, colher, colheita, vento, plantei, plantar, plantio, horta, época]
exige_ferramenta: true
---
# Skill: Clima e plantio

## 1. Buscar os dados
1. Pergunta geral sobre o tempo ou sobre o que fazer hoje: use `clima_lavoura`.
2. Pergunta sobre um período ("amanhã", "fim de semana", "a semana", "as próximas duas semanas"): use
   `previsao_periodo` (hoje, amanha, fds, 3, 7 ou 14).
   A que horas vai chover ("que horas chove?", "chove hoje à tarde?", "dá para pulverizar de manhã?"): use
   `chuva_por_hora`, que traz as janelas hora a hora (até 7 dias: "nesta semana" = `horas: 168`). Diga que é previsão
   por hora (pode adiantar ou atrasar 1 a 2 h), sem prometer o minuto exato.
   Chuva agora ou chegando ("está chovendo aí?", "a chuva está vindo?", "dá tempo de colher antes da chuva?"): use
   `radar_chuva`, que lê o radar meteorológico e diz se a chuva vem e a que horas chega (até 3 h). Se a pergunta for
   "chove hoje à tarde?" e for perto da hora, use as duas.
3. Quando plantar, ou o que plantar agora (na horta ou na lavoura): use `epoca_de_plantio`. A época vem do zoneamento
   oficial (ZARC) do município da pessoa; para plantas sem zoneamento (alface, couve, temperos), diga que não há
   calendário oficial, sem inventar meses. Se, depois da lista do que plantar agora, a pessoa perguntar por uma
   planta que não estava nela ("e o tomate?"), chame de novo com `sugerir: true` e `plantas: ["tomate"]`: ela entra a
   mais na tabela.
4. Como estão as plantas da pessoa (fase, colheita estimada): use `minhas_plantas`.
5. Irrigar ou falta de água: use `balanco_agua`.
6. Se a pessoa contar o que planta, quando plantou, a fase ou se irriga ("plantei soja dia 10", "tenho alface e couve
   na horta", "não planto mais tomate"), registre com `definir_planta` (uma chamada por planta) e confirme em uma frase.
7. A pessoa pode ter vários lugares (fazenda, sítio, horta de casa). Se ela citar um ("no sítio", "lá em Rio Verde"),
   passe `lugar` nas ferramentas; sem isso, vale o lugar em uso. `meus_lugares` lista os lugares.
8. Água da planta ("quanto preciso irrigar?"): `minhas_plantas` traz, por planta, quanto ela deve usar nos próximos 7 dias
   e quanto a chuva prevista cobre (1 mm = 1 litro por m²); `balanco_agua` traz o que já faltou nos últimos dias.
9. Como cuidar da planta (adubação, espaçamento, poda, pragas, "o que fazer para desenvolver melhor"): pesquise com
   `pesquisar_web` priorizando a Embrapa (ex.: "embrapa sistema de produção cultivo de uva") e leia a página com
   `ler_pagina`. Responda só com o que a fonte diz, cite o link e diga que vale confirmar com um técnico da região.
   Não invente dicas nem números de manejo.
10. Se a ferramenta disser que falta a localização, repita o jeito de mandar que ela trouxe (já vem certo para o canal:
    no chat web é o botão 📍, no Telegram o /start). Não explique o outro canal.
11. Mensagem automática ("me mande o tempo todo dia", "às 6h", "pare de mandar", "volte a mandar"): use
    `avisos_automaticos` (ligar com `horarios` quando a pessoa disser a hora; pausar; voltar; ver) e confirme em uma
    frase o que ficou valendo, com o que a ferramenta disser sobre onde a mensagem chega.

## 2. Responder
- As ferramentas já mandam a imagem com os dados junto da resposta: responda em 2 ou 3 frases, sem repetir tabelas.
- Comece pela resposta direta ("Sim, sábado deve chover cerca de 12 mm à tarde").
- Use só os números que vieram das ferramentas; diga "previsão" e "chance", nunca certeza.
- Recomendações de manejo vêm das regras da fita (pulverização, irrigação, geada...). Se a mensagem disser
  "(regra em revisão)", mantenha esse aviso.
- Termine com uma ação concreta quando houver ("se for pulverizar, prefira das 6h às 10h").

## Regras
- Nunca indique defensivo nem dose: isso exige receituário de um(a) agrônomo(a). Pode sugerir olhar as folhas.
- Português simples, frases curtas. A pessoa pode ter uma fazenda ou só uns vasos: não presuma o tamanho.
- Não repita a coordenada da pessoa; fale o nome do lugar.
- Não indique outros aplicativos, sites ou serviços de previsão (nem "abra um app de radar"): o radar e a previsão
  estão nas ferramentas da fita. O que elas não trazem, diga que não tem.
