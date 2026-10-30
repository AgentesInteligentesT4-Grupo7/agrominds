# Painel da AgroMinds (Angular)

Painel administrativo da fita: quem pode usar o bot (convites com QR, pedidos, bloqueio), o que foi enviado a cada
pessoa e os gráficos do tempo de cada lavoura (meteograma, umidade e VPD, previsto × ocorrido, balanço de água,
linha do tempo dos alertas, mapa). Angular 22, Angular Material, ECharts (ngx-echarts) e Leaflet com OpenStreetMap.

## Construir

Na pasta da fita (`agrominds/`):

```bash
npm --prefix admin ci          # dependências (só na primeira vez)
npm --prefix admin run build   # gera admin/dist, que o bot serve
```

## Usar

1. Crie a sua conta: `npm run fita -- agrominds admin-criar voce@exemplo.com` (na pasta do K7; pede a senha).
2. Ligue o bot da fita (`npm run dev -- --perfil agrominds` ou pela página de administração do K7).
3. Abra `http://127.0.0.1:8790/` (porta em `ADMIN_PORTA`; para abrir na rede, `ADMIN_HOST=0.0.0.0`).

Contas "só leitura" veem tudo e não mudam nada (bom para apresentar). Cada gráfico salva PNG (ícone no canto) e as
listas exportam CSV.

## Desenvolver

Com o bot ligado (a API fica em 127.0.0.1:8790): `npm --prefix admin start` abre o Angular em
`http://localhost:4200` com recarga automática, repassando `/api` para o bot (`proxy.conf.json`).
