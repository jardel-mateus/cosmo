# 🪐 Cosmo

**Seu universo de recomps, ports e emuladores.**

O Cosmo é um gerenciador de biblioteca especializado em projetos de engenharia reversa (recomps) e ports. Ele centraliza o catálogo do Recompendium (e de quantos catálogos extras você quiser), monitora novidades, gerencia seus jogos instalados e rastreia conquistas, com um palco 3D de consoles e um visual espacial.

> **Origem:** o Cosmo é um fork do **Cartucho**, de **Jardel Mateus Dias de Oliveira** (licença MIT, desenvolvimento original encerrado em outubro de 2025). O aviso de copyright original está em `LICENSE.txt`.

## 📥 Baixar

Pegue o instalador mais recente (`Cosmo-x.y.z-windows.exe`) na página de **[Releases](https://github.com/jardel-mateus/cosmo/releases/latest)**. O Windows pode avisar que o app não é assinado: clique em *Mais informações › Executar assim mesmo*.

## 💚 Apoie o projeto

O Cosmo é gratuito. Se ele te ajudou, considere uma doação por **Pix**:

- **Chave Pix (e-mail):** `jardelmateus53@gmail.com`
- Dentro do app: menu **☰ › Apoie o Cosmo** mostra o QR code e o botão **Pix copia e cola**.
- Também ajuda: dar uma ⭐ no repositório e [abrir uma issue](https://github.com/jardel-mateus/cosmo/issues/new) com jogo faltando, capa errada ou sugestão.

## ✨ O que mudou em relação ao Cartucho

- **Nova identidade:** nome, ícone, abertura (planeta com anel), paletas *Cosmo*, *Aurora* e *Nebulosa*, fontes modernas (Rubik + Nunito). O filtro CRT continua disponível nas configurações, só vem desligado.
- **Mais fontes de capas:** LaunchBox → **Libretro Thumbnails** (acervo do RetroArch, via GitHub) → **Steam** (agora para todas as plataformas, não só PC). Se uma fonte estiver fora do ar, a capa é tentada de novo depois em vez de ficar marcada como "sem capa".
- **Mais fontes de jogos:** arquivo `fontes.json` na pasta de dados (botão **Fontes de jogos** no Radar). Aceita URLs ou arquivos locais no formato do Recompendium; os jogos aparecem junto com o catálogo principal.
- **Atualização automática pelo repositório do Cosmo:** o app procura versões novas em [jardel-mateus/cosmo/releases](https://github.com/jardel-mateus/cosmo/releases). Links de apoio, estrela e issues ficam em `src/shared/links.ts`.

### Catálogos extras (`fontes.json`)

Fica em `%APPDATA%\Cosmo\fontes.json` (criado na primeira vez que o app abre):

```json
{
  "catalogos": [
    "https://exemplo.com/meu-catalogo.json",
    "C:\\Users\\voce\\Documents\\meus-jogos.json"
  ]
}
```

Cada catálogo é `{ "formato": 1, "entradas": [ ... ] }` ou só a lista de entradas. Campos mínimos de uma entrada: `entry` (id único), `nombre` (título), `consola` (`n64`, `ps2`, `pc`, `switch`…) e, para instalar pelo app, `repo` (`dono/projeto` no GitHub). Também dá para usar a variável de ambiente `COSMO_EXTRA_CATALOGS` (separada por `;`).

---

## ⚖️ Aviso Legal

O Cosmo é um projeto pessoal, gratuito e independente, sem qualquer vínculo com Nintendo, Sony, Microsoft, Sega ou qualquer outra fabricante/editora. 

- **Não Distribuição:** O software **não contém nem distribui** ROMs, ISOs, chaves, firmwares, BIOS ou arquivos de jogos.
- **Requisito de Posse:** Para utilizar os recomps, é necessário possuir a cópia legal do jogo, extraída por você do seu próprio hardware.
- **Fontes de Dados:** A lista de jogos é consumida via [Recompendium](https://recompendium.com/) e as artes via [LaunchBox Games Database](https://gamesdb.launchbox-app.com/).
- **Consoles Atuais:** Para plataformas ainda comercializadas (como Nintendo Switch), o app atua apenas como catálogo informativo; a instalação deve ser feita manualmente pelo usuário.

---

## 🚀 Funcionalidades Principais

### 🎮 Experiência Imersiva
- **Palco 3D:** Navegação espacial com 20 slots para consoles (do NES ao PS5, passando por Xbox, Mega Drive e PC). Você define quais consoles aparecem no palco; os demais ficam organizados na seção "Outros".
- **Hubs Temáticos:** Cada console possui uma interface personalizada que remete à sua era.
- **Meus Jogos:** Visualização de biblioteca com representações físicas (cartuchos e caixas) fiéis aos originais.

### 🛠️ Gestão e Automação
- **Instalação Inteligente:** Download e atualização automática via GitHub (exceto consoles atuais). O sistema valida hashes, passa pelo Windows Defender e organiza os executáveis.
- **Rastreamento de Tempo:** Contador de horas jogadas estilo Steam, funcionando inclusive para jogos abertos externamente, desde que o Cosmo esteja em segundo plano.
- **Sistema de Conquistas:** Leitura em tempo real de arquivos de progresso de recomps suportados (UnleashedRecomp, MarathonRecomp, Sonic 3 A.I.R., etc.), com notificações instantâneas ao desbloquear.

### 🔍 Descoberta e Customização
- **Radar de Novidades:** Alertas automáticos sobre novos jogos no catálogo, mudanças de status de desenvolvimento ou novas versões de jogos instalados.
- **Catálogo Unificado:** Tela de busca global com filtros avançados por plataforma, gênero ou status.
- **Personalização Visual:** Suporte a filtros CRT, paletas de cores customizáveis, modo tela cheia (Alt+Enter) e sons de interface.

---

## 🕹️ Interface e Controles

O sistema foi projetado para ser **100% operável via controle** (Xbox, PlayStation, Nintendo), mas mantém suporte total a teclado e mouse.

| Comando | Ação |
| :--- | :--- |
| **Setas / Enter / Esc** | Navegação básica e confirmação |
| **Tab** | Alterna entre Início e Consoles |
| **Q / E** | Troca rápida de console ou aba |
| **X** | Abre menu de ações do jogo |
| **Y** | Ativa a busca (com teclado virtual) |
| **F1 / Start** | Abre o menu principal |
| **F2 / Select** | Abre opções rápidas |
| **S** | Configurações do sistema |
| **P** | Alterna paleta de cores |
| **M** | Muta/Ativa o som |

---

## 💻 Guia Técnico (Desenvolvedores)

### Requisitos
- **Node.js 22.13+** (Recomendado v24 LTS)
- **SQLite** (Integrado ao Node/Electron)

### Execução Rápida
```bash
npm install
npm run dev
```

### Comandos de Manutenção
- `npm test`: Valida leitores de arquivos e o serviço de conquistas.
- `npm run typecheck`: Verificação de tipos TypeScript.
- `npm run build`: Compila a versão de produção em `/out`.
- `npm run dist`: Gera o instalador `.exe` para Windows.

### Variáveis de Ambiente (Dev)
Para testar o app com dados alternativos, utilize:
- `CARTUCHO_USER_DATA`: Define uma pasta de perfil isolada.
- `CARTUCHO_CATALOG_URL`: Aponta para um JSON local de catálogo.
- `GITHUB_TOKEN`: Aumenta o limite de requisições da API do GitHub.

---

## 📂 Estrutura do Projeto

```text
src/
 ├── main/           # Core Electron (tRPC, SQLite, Atualizador, Lógica de Ports)
 │    └── achievements/ # Adaptadores de leitura de saves e conquistas
 ├── preload/        # Ponte de comunicação segura (IPC)
 ├── renderer/       # Frontend React
 │    ├── stage/     # Cena 3D com React Three Fiber (R3F)
 │    ├── hubs/      # Interfaces específicas de cada console
 │    └── views/     # Telas de Perfil, Radar e Configurações
 └── shared/         # Tipos e esquemas de banco de dados compartilhados
```

---

## 📜 Créditos e Licença

- **Projeto original (Cartucho):** Jardel Mateus Dias de Oliveira — desenvolvimento e arquitetura.
- **Modelos 3D:** Diversos autores (consultar `src/renderer/public/models/CREDITOS.md` para licenças NC — uso não comercial).
- **Dados:** Recompendium, LaunchBox Games Database, libretro-thumbnails e Steam.
- **Inspirações:** Lógica de acompanhamento baseada no projeto Harbour (MIT-0).

**Licença:** Este código é distribuído sob a licença **MIT**.
