# Mapeamento Completo da Reformulação de Arquitetura e UX - Invictus

## Filosofia
O Invictus é um aplicativo para **TREINAR**. Todo o restante existe para apoiar essa ação. Ao abrir o aplicativo, o usuário entende em menos de 3 segundos o que fazer: **TREINAR**.

Toda a complexidade técnica foi mantida intacta nos bastidores e reorganizada principalmente em **Perfil > Configurações**.

---

## Navegação Principal (Menu Inferior)
A barra inferior possui estritamente **quatro abas**:
1. 🏠 **Home** (`/`)
2. 🏆 **Ranking** (`/rankings`)
3. 🎯 **Desafios** (`/challenges`)
4. 👤 **Perfil** (`/profile`)

*Nota: Configurações, Carteira e Integrações NÃO existem como abas do menu inferior.*

---

## Tabela de Mapeamento de Funcionalidades

| Funcionalidade / Módulo | Localização Anterior | Nova Localização | Justificativa de UX |
| :--- | :--- | :--- | :--- |
| **Boas-vindas, Foto, Streak, Liga, Nível, XP, IV Coins, Próxima Temporada** | Home | **Home (Início)** | Informações essenciais do progresso do atleta e engajamento em menos de 3 segundos. |
| **Resumo dos Desafios do Dia** | Home | **Home (Início)** | Foco no objetivo diário antes de iniciar o treino. |
| **Grande Botão "INICIAR TREINO"** | Home | **Home (Início)** | Ação principal absoluta do aplicativo. |
| **Fluxo Rápido de Treino (Musculação / Cardio)** | Várias telas/passos | **Home > Modalidade > Preparação** | Sem perguntas intermediárias ou confirmações desnecessárias. Validações ocorrem em segundo plano. |
| **Tela de Preparação de Treino** | Telas complexas | **Tela Direta (Musculação/Cardio)** | Exibe apenas academia/atividade, cronômetro, FC, distância/calorias e o grande botão INICIAR TREINO. |
| **Sincronização Pendente** | Botões grandes na Home | **Indicador Discreto na Home** | Toque no indicador redireciona para Configurações > Integrações. |
| **Ranking Geral, Ligas, Divisões, Eventos, Temporadas, Combates** | Abas separadas | **Ranking (`/rankings`)** | Centraliza toda a experiência competitiva do ecossistema Invictus. |
| **Desafios Diários, Semanais, Mensais, Temporada, Liga, Patrocinados, Especiais e Concluídos** | Missões / Várias telas | **Desafios (`/challenges`)** | Central única de objetivos com cards simples (nome, objetivo, progresso, tempo, recompensas). |
| **Foto, Nome, Liga, Nível, XP, IV Coins, Selo Premium, Conquistas, Badges, Histórico, Resumo de Evolução** | Perfil | **Perfil (`/profile`)** | Identidade do atleta, recordes, dias treinados e tempo de treino. |
| **Botão 'Editar Perfil'** | Perfil | **Perfil (`/profile`)** | Edição rápida da foto e dados do atleta. |
| **Botão 'Carteira'** | Menu Inferior (`/wallet`) | **Perfil > Botão Carteira** | Acesso às finanças, extrato e saques sem poluir o menu principal de treino. |
| **Botão 'Configurações'** | Menu Inferior / Vários | **Perfil > Botão Configurações** | Acesso único para a central de ajustes técnicos do aplicativo. |
| **Gestão de Conta, Dados Pessoais e Segurança** | Configurações | **Perfil > Configurações > Conta & Segurança** | Alteração de email, senha, biometria e exclusão. |
| **Gestão de Academia (Seleção, Troca, Solicitação)** | Home / Menu | **Perfil > Configurações > Academia** | Gestão administrativa da unidade e local de treino. |
| **Integrações (Strava, Apple Health, Health Connect, GPS, Sensores)** | Home / Configurações | **Perfil > Configurações > Integrações** | Centralização técnica de todos os serviços e sensores de saúde. |
| **Smartwatch e Telemetria em Tempo Real** | Menu / Wearables | **Perfil > Configurações > Integrações > Smartwatch** | Configuração do relógio e monitor cardíaco. |
| **Gestão de Assinatura Premium** | Banners na Home | **Perfil > Configurações > Assinatura** | Detalhes de plano, cobrança, upgrade e restauração sem agressividade na Home. |
| **Privacidade, Permissões e Termos** | Vários | **Perfil > Configurações > Privacidade & Permissões** | Controle centralizado de permissões de localização, saúde e termos. |
| **Suporte, FAQ, Ajuda, Sobre e Regras** | Vários | **Perfil > Configurações > Ajuda & Sobre** | Documentação e atendimento ao usuário. |
| **Painel de Saúde / Interpretador de Condicionamento** | Gráficos técnicos densos | **Perfil / Relatório Fisiológico** | Exibição de frases simples de interpretação ("Seu condicionamento melhorou", etc.). Dados técnicos em relatório detalhado. |
| **Dieta** | Menu Principal | **Oculto (Código Preservado)** | Ocultado da navegação visível, pronto para futura reativação. |

---

## Garantias e Integridade Backend
- Nenhuma regra de negócio, Score Engine, Reward Engine, Wallet, IA, rotas de API, Firestore schemas ou scripts foram modificados ou removidos.
- Todo o poder técnico permanece ativo em segundo plano, oferecendo uma experiência extremamente rápida e limpa para o usuário.

