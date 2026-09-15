# Timezone competitivo

O calendário competitivo do Invictus não depende do timezone do host serverless.

- Padrão: `America/Sao_Paulo`.
- Override operacional: `COMPETITION_TIME_ZONE` com um timezone IANA válido.
- Semana competitiva: segunda-feira 00:00 local até a segunda seguinte 00:00 local.
- Mês/temporada mensal: primeiro dia 00:00 local até o primeiro dia do mês seguinte 00:00 local.
- Datas persistidas continuam em ISO/UTC; o timezone define apenas as fronteiras civis usadas para score e fechamento.
- `system_config/season_tracker` é normalizado pelo `seasonId` quando um tracker legado contém fronteiras antigas em UTC.

Não usar offsets fixos como `-03:00`: o helper usa timezone IANA para preservar o horário civil também em regiões com DST.
