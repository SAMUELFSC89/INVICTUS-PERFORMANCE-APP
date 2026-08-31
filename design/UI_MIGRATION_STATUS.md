# Migração visual Invictus

Este arquivo é o controle único da migração para o novo sistema visual. Uma rota
só pode ser marcada como concluída depois de: visual novo, dados reais,
navegação funcional, responsividade e ausência de acesso ao visual substituído.

## Assets aprovados para preservação

- `public/ranking-frame-gold-reference.png`
- `public/ranking-frame-silver-reference.png`
- `public/ranking-frame-bronze-reference.png`
- `public/capacete.webp` (logo oficial otimizada usada na interface)
- `public/capacete.png` (fonte oficial em alta resolução/fallback)

As três molduras do Top 1, Top 2 e Top 3 e a logo oficial foram aprovadas
explicitamente e devem ser mantidas nas novas telas.

## Rotas principais

| Rota | Estado | Observação |
| --- | --- | --- |
| `/` | Implementada | Home nova com asset próprio, dados homologados e atalhos funcionais |
| `/musculacao` | Em revisão | Hub e criadores novos; botão de informações conectado e fluxo real preservado |
| `/challenges` | Em revisão | Hub novo, missões reais, destaque Power Lift e histórico em shell novo |
| `/power` | Em revisão | CSS único novo em todos os estados; upload, IA fail-closed, auditoria e vídeos preservados |
| `/championships` | Em revisão | Hub, comunidade, prévias e saída do campeonato free para Musculação/Cardio novos |
| `/profile` | Em revisão | Perfil novo com dados reais |
| `/store` | Implementada | 21 produtos reais + 10 itens próprios `EM BREVE`; detalhes e checkout próprios; preços/Coins permanecem a definir |
| `/rankings` | Em revisão | Preservar molduras aprovadas do Top 3 |

## Rotas secundárias a migrar

- `/notifications` — shell novo integrado ao sino; somente dados reais
- `/league` e `/league/inscricao` — fluxo antigo encerrado e redirecionado para Campeonatos
- `/profile/:userId` — migrado para o shell preto/dourado; perfil público usa apenas campos públicos reais e reconhecimento passa pela API autenticada
- `/profile/academy` e subfluxos — shell visual novo; funções preservadas
- `/profile/wearables` — shell visual novo; integrações nativas preservadas
- `/profile/wallet` — fluxo financeiro legado encerrado; redireciona para a Loja
- `/profile/goals` — shell visual novo
- `/profile/security` — shell visual novo
- `/profile/preferences` e documentos — shell visual novo, termos/FAQ/jogo/admin preservados
- `/championships/my` e `/championships/my/:id` — redirecionadas para o campeonato social novo; telas legadas sem acesso
- `/achievements` — migrado; bloqueios dependem das conquistas concedidas pelo servidor e o card de compartilhamento foi preservado
- `/performance` — migrado; motor analítico, confiabilidade, metodologia e IA preservados com UI mobile nova
- `/health` — migrado para o shell novo; Health Data Layer e atividades homologadas preservadas
- `/health/report` e `/health/report/full` — identidade oficial aplicada; relatório detalhado preserva o formato de leitura/impressão
- telas de retorno de assinatura — migradas; consulta nativa usa `API_CONFIG` e polling corrigido

As rotas administrativas agora usam um shell próprio preto/dourado, isolado da
UI pública. As ferramentas internas foram preservadas; a revisão visual dos
conteúdos densos de cada painel continua na auditoria final.

## Remoções já concluídas

- `src/pages/Profile.tsx` — substituída por `ProfileNew` e `ProfileSecondary`
- `src/pages/League.tsx` — substituída pelo novo fluxo de Campeonatos
- `src/pages/SeasonInscription.tsx` — rota antiga encerrada; integrações financeiras do backend permanecem isoladas até auditoria
- `public/league-trophy-hero-v2.jpg` e estilos `.league-*` — pertenciam somente às telas removidas
- `src/components/Onboarding.tsx` — sobreposição antiga duplicada; consentimento permanece no fluxo atual e academia/cidade não bloqueiam o uso geral
- telas antigas `ChampionshipDetails`, `ChampionshipRegistration`, `ChampionshipCheckoutAsaas`, `ChampionshipConfirmation`, `ChampionshipRegulation`, `MyChampionships`, `MyChampionshipDetail` e `AthleteIllustration` — todas sem rota ativa, substituídas pelo hub, campeonato social e prévias novas

## Assets novos criados para a migração

- `public/assets/home/home-season-warrior-v1.png` — banner exclusivo da Home, sem texto ou dados embutidos; todo conteúdo continua sendo renderizado pelo aplicativo
- `public/assets/store/products/own-brand/*.png` — dez recortes próprios derivados da referência aprovada: moletom, regata, camiseta, calça, strap, cinta, coqueteleira, munhequeira, boné e meia; sem preços ou dados da captura

## Próxima fase — após concluir esta migração

Implementar o ecossistema transversal definido no documento do produto:
assinaturas Free/Pro configuráveis, ledger imutável de Invictus Coins, Loja,
Drops, frete, recompensas, campeonatos de musculação/cardio, auditoria intermediária do
Top 3, orçamento de recompensas, feature flags e painel administrativo.

Esta fase permanece deliberadamente posterior à estabilização das atividades e
das telas atuais. Valores comerciais, preços, multiplicadores, datas, estoque e
premiações não serão inventados nem fixados no frontend.

Referência visual aprovada para a Loja:

- `design/references/loja-invictus-aprovada.png`

O layout, proporções, hierarquia e identidade dessa imagem devem ser seguidos.
Saldo, próximo Drop, produtos, imagens, categorias, preços em Coins, complemento
financeiro e disponibilidade virão exclusivamente do backend/configuração real.

## Loja física — estado da implementação

- 21 produtos reais cadastrados por `productId` interno; 16 têm GTIN validado. Os 3 Santo Hábito mantêm os códigos informados com GTIN e custo pendentes; Calcium Maxx K2 e DIMAG preservam os códigos recebidos como candidatos porque o checksum não é válido.
- 10 produtos próprios cadastrados como `COMING_SOON` / `PRODUCT_DEVELOPMENT_PENDING`, incluindo munhequeira, boné e meia.
- Os itens próprios aparecem com imagem e CTA `EM BREVE`, sem fornecedor, custo, preço, Coins, estoque ou EAN/SKU inventados.
- A ativação administrativa exige fornecedor, custo, preço, estoque, EAN/SKU, imagens e precificação completos.
- Produtos visíveis para pré-visualização mesmo enquanto imagem, preço e Coins estão pendentes, conforme decisão posterior do proprietário.
- `ProductImage` centraliza imagem principal, thumbnail, galeria e placeholder neutro.
- Tela de detalhe separa compra em dinheiro de resgate com Coins.
- Checkout físico possui produto, quantidade, endereço, resumo e confirmação de resgate.
- Resgate em Coins é atômico: valida Drop/saldo/estoque, reserva o estoque, debita o ledger e cria pedido com snapshot.
- Compra em dinheiro permanece sem cobrança até preço, frete e gateway físico serem configurados; não reutiliza assinatura Pro.
- Painel administrativo permite preço, custos, margem, markup, Coin Price, complemento, estoques, publicação, descrição e destaques.
- Painel de Drops controla período, produtos, frete, custos e exposição financeira máxima.
- Custos, margens, histórico, Drops e pedidos não possuem acesso direto pelo SDK cliente.
- Os assets dos 10 itens próprios e dos 21 produtos reais estão vinculados. O catálogo real usa as imagens fornecidas pelo usuário ou fotos originais correspondentes, sem reconstrução por IA.

## Políticas e regras — versão 4.0.0

- Termos, privacidade, saúde, antifraude, assinaturas, exclusão, consentimentos e FAQ foram alinhados ao ecossistema novo.
- O novo aceite geral não autoriza automaticamente saúde, GPS, câmera, vídeo ou notificações; cada permissão permanece contextual.
- Invictus Coins são cumulativos e usados na Loja, sem valor monetário, transferência, venda ou saque PIX.
- Campeonato gratuito é social, sem prêmio financeiro e sem vínculo com academias.
- Campeonatos pagos de musculação e cardio permanecem `EM BREVE`; catálogo e cobrança do servidor ficam fechados até a aprovação de uma edição e seu regulamento específico.
- A rota pública da carteira financeira legada redireciona para a Loja; Coins não são confundidos com saldo em reais.
- As APIs legadas de carteira/saque PIX e inscrição de temporada paga respondem como encerradas e não criam novas cobranças ou solicitações.
- A versão de aceite foi elevada para `4`, exigindo nova confirmação das contas que aceitaram documentos anteriores.
- Os textos são uma implementação de produto e precisam de revisão jurídica profissional antes da publicação comercial definitiva.
