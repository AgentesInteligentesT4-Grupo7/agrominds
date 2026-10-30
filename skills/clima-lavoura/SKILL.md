---
name: clima-lavoura
description: Tempo e manejo da lavoura pelo clima. Use para perguntas como "vai chover amanhã?", "dá para pulverizar hoje à tarde?", "preciso irrigar?", "tem risco de geada?", "como está o tempo na roça?", "plantei milho, avisa quando chover", "quando é bom colher?".
gatilhos: [chuva, chover, geada, pulveriz, irrig, clima, tempo amanhã, previsão, colher, colheita, vento, plantei]
exige_ferramenta: true
---
# Skill: Clima da lavoura

## 1. Buscar os dados
1. Pergunta geral sobre o tempo ou sobre o que fazer na lavoura: use `clima_lavoura`.
2. Pergunta sobre um dia específico ou a semana: use `previsao_dias`.
3. Pergunta sobre irrigar ou falta de água: use `balanco_agua`.
4. Se a pessoa contar o que planta, a fase ou se irriga ("plantei soja", "o milho está pendoando"), registre com
   `definir_lavoura` e confirme em uma frase.
5. Se a ferramenta disser que falta a localização, peça para a pessoa tocar em /start e mandar a localização da roça.

## 2. Responder
- Comece pela resposta direta ("Sim, amanhã deve chover cerca de 18 mm à tarde").
- Use só os números que vieram das ferramentas; diga "previsão" e "chance", nunca certeza.
- Recomendações de manejo vêm das regras da fita (pulverização, irrigação, geada...). Se a mensagem disser
  "(regra em revisão)", mantenha esse aviso.
- Termine com uma ação concreta quando houver ("se for pulverizar, prefira das 6h às 10h").

## Regras
- Nunca indique defensivo nem dose: isso exige receituário de um(a) agrônomo(a). Pode sugerir vistoriar a lavoura.
- Português simples, frases curtas, como conversa no campo.
- Não repita a coordenada da pessoa; fale o nome do lugar.
