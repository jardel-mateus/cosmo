# Conquistas: como o Cosmo lê

O Cosmo **só lê**. Nunca escreve na pasta do jogo nem nos saves.

São três camadas. As duas primeiras estão prontas:

1. **Desbloqueios**: o arquivo onde o próprio recomp grava o que você conquistou.
2. **Lista original**: nomes, descrições, pontos e ícones tirados da sua cópia do jogo (no Xbox 360, o XDBF dentro do executável). Quando o jogo não tem isso, usamos a lista que está no código do recomp.
3. *(futuro)* Um protocolo aberto para recomps sem conquistas próprias avisarem o Cosmo.

Depois que um desbloqueio aparece, ele fica no banco do Cosmo mesmo que o save seja apagado, como na Steam. Quando o arquivo não guarda a data, usamos a hora em que o Cosmo viu o desbloqueio pela primeira vez.

## Recomps suportados

| Recomp | Como reconhece a pasta | Lista | Desbloqueios |
|---|---|---|---|
| UnleashedRecomp | `UnleashedRecomp.exe` | XDBF de `patched/default.xex` (gerado pelo instalador do recomp) | `%APPDATA%\UnleashedRecomp\save\ACH-DATA`, ou `<pasta>\save\ACH-DATA` se existir `portable.txt` |
| MarathonRecomp | `MarathonRecomp.exe` | XDBF de `decrypted/default.bin` | `%APPDATA%\MarathonRecomp\save\SonicNextAchievementData.bin` (mesma regra do `portable.txt`) |
| Sonic 3 A.I.R. | `Sonic3AIR.exe` | 18 conquistas do código do jogo | `<pasta>\savedata\storage\s3air_achievements.bin` se existir a pasta `savedata`, senão `%APPDATA%\Sonic3AIR\storage\…` |
| Sonic 1/2 (2013), RSDKv4 | `RSDKv4.exe` + `Data.rsdk` | 12 conquistas de cada jogo, do código do Retro Engine | `<pasta>\UData.bin` |

## Jogos de PC (Steam, emuladores de Steam e GOG)

O Cosmo reconhece a pasta do jogo e escolhe o leitor, nesta ordem: recomps acima, Steam, GOG, emulador de Steam. Jogos que já estavam na biblioteca são reconhecidos ao abrir o Cosmo. O id de cada conquista é um hash (FNV-1a, 31 bits) do nome de API, então a lista e os desbloqueios casam mesmo vindo de lugares diferentes.

| Origem | Como reconhece | Lista | Desbloqueios |
|---|---|---|---|
| Steam | pasta em `steamapps/common` com `appmanifest_*.acf` | `appcache/stats/UserGameStatsSchema_<jogo>.bin` da Steam; senão a Web API (`GetSchemaForGame`) com a chave das configurações | `appcache/stats/UserGameStats_<conta>_<jogo>.bin` (bits por stat + `AchievementTimes`) |
| Emulador de Steam | `steam_appid.txt`, `steam_settings/` ou `steam_emu.ini` até 3 níveis abaixo da pasta | `steam_settings/achievements.json` do próprio jogo; senão a lista da Steam do PC; senão a Web API | `%APPDATA%\GSE Saves\<jogo>\achievements.json`, `%APPDATA%\Goldberg SteamEmu Saves\…`, save local (`local_save.txt` ou `local_save_path`), `%PUBLIC%\Documents\Steam\CODEX\<jogo>\achievements.ini`, `%APPDATA%\Steam\CODEX\…`, `%PUBLIC%\Documents\Steam\RUNE\…` |
| GOG | `goggame-<produto>.info` | `gameplay.gog.com/clients/<produto>/users/<conta>/achievements` com o login da GOG | o mesmo endereço; conferido ao fechar o jogo e a cada 5 min com ele aberto |

Os arquivos da Steam são KeyValues binário (`src/main/achievements/vdf.ts`). Nada é enviado para a Steam nem para a GOG.

**Epic Games Store**: não há API pública para ler conquistas do jogador (a própria Epic diz isso no fórum de desenvolvedores), então não é lido.

## Recomps com conquistas próprias (leitor genérico)

Cada recomp guarda conquistas do seu jeito, então o leitor `recomp-local` não depende de conhecer o projeto:

1. **Desbloqueios**: procura, até 3 níveis dentro da pasta do jogo e na pasta que o recomp cria em AppData com o nome do .exe, os nomes de arquivo mais usados (`ACH-DATA`, `trophies.txt`, `trophies.jsonl`, `trophies.json`, `achievements.txt/.json/.ini`, `earned.tsv`…) e qualquer arquivo de texto com "achiev", "troph" ou "earned" no nome. O conteúdo decide: só conta se tiver desbloqueios (ids, com ou sem hora, ou objetos marcados como desbloqueados). Arquivos de nomes, textos e listas nunca contam como desbloqueio.
2. **Lista** (`src/main/achievements/discover.ts`): procura perto dali arquivos que pareçam listas (JSON, HTML, INI/TOML, TSV/CSV/texto) e tira deles nome interno, nome e descrição do jeito que der (texto por idioma incluído). Fica com a lista que mais casa com os desbloqueios e, no empate, a mais comprida. É relida toda vez que o Cosmo abre.
3. **Ícones**: imagens com o mesmo nome interno da conquista (ex.: `img/relic_1.png`), perto da lista ou nas pastas do jogo.
4. **Sem lista**: o nome interno vira algo legível ("relic_1" → "Relic 1", "12" → "Conquista 12"), e a tela mostra "N desbloqueadas" sem total.

Arquivos binários próprios (`trophies.dat`, `trophies.bin`, `achievements.dat`) continuam sem leitura.

## Índice de conquistas dos recomps

`conquistas.json`, no ramo `dados` (gerado toda segunda pelo workflow **Índice de conquistas**; uma cópia vai dentro do app em `src/main/achievements/data/indice.json` para funcionar antes da primeira publicação). O Cosmo baixa o índice ao abrir, guarda a última cópia e usa as dicas do projeto de cada jogo, casado pelo repositório do GitHub.

- **Gerado sozinho** (`scripts/conquistas.ts`): baixa só o código-fonte dos recomps de consoles que tinham conquistas ou troféus e procura os nomes dos arquivos de conquista que cada projeto grava (`procurar`). Com esses nomes, o Cosmo desce mais fundo nas pastas do jogo e do usuário (até 5 níveis, inclusive `game/`, `data/`, `content/`).
- **Escrito à mão** (`scripts/conquistas-manuais.json`): completa ou corrige a varredura com caminhos exatos (`desbloqueios`), a lista (`lista`, de um arquivo ou de uma URL), uma lista escrita no próprio índice (`conquistas`) e o padrão dos ícones (`icones`, com `{id}`).

Caminhos aceitam `{jogo}`, `{appdata}`, `{localappdata}`, `{documentos}`, `{publico}`, `{usuario}`, `{jogos_salvos}` e `*` num trecho. Formatos: `auto`, `hedge`, `linhas`, `jsonl`, `json`, `ini`, `tenoke`, `goldberg`, `earned`, `binario`.

Para pôr um projeto novo, basta uma linha em `conquistas-manuais.json` (ou esperar a varredura da semana); não precisa de versão nova do Cosmo.

Formatos de kits que já são entendidos: hedge-dev (`ACH-DATA`), rexglue (`[unlocked.N]` com `filetime`, e a lista em `[[achievements]]` com `id`/`label`/`description`), TENOKE, Goldberg/GSE, CODEX/RUNE, o mod de conquistas do Recompia, e texto, JSON, JSON por linha, INI e TSV genéricos.

## RetroAchievements

Ficou de fora de propósito. A API pública (`API_GetGameExtended`) só dá um hash das regras (`MemAddr`), não as regras. As regras só saem pela conexão dos emuladores, e o RetroAchievements exige que o emulador seja aprovado e proíbe ferramentas que leem ou editam a memória. Ler a memória de um recomp com as regras deles iria contra isso.

## Formatos

### hedge-dev (UnleashedRecomp e MarathonRecomp)

Little-endian, empacotado:

```
'ACH ' | version u32 (=1) | checksum u32 | reserved u32
N × { id u16, time_t i64, reserved u16[3] }      N = 50 (Unleashed) ou 23 (Marathon)
```

- O checksum é o XOR de todos os bytes dos registros. Se não confere (arquivo no meio da gravação), o Cosmo tenta de novo algumas vezes.
- Um id 0 encerra a lista.
- Os ids são os mesmos das conquistas no XDBF.

### Sonic 3 A.I.R. (Oxygen Engine, `PersistentData`)

```
'OXY.PDATA' | version u16 | count u32 | count × { key: len u32 + bytes, data: len u32 + bytes }
chave "Achievements": count u32 | count × { id u32, state u32 }      state ≠ 0 = conquistada
```

Não guarda a data.

### RSDKv4 (`UData.bin`)

```
64 × status i32 (100 = conquistada) | 128 × placar i32
```

Não guarda a data. O mesmo executável roda o Sonic 1 e o Sonic 2. O Cosmo escolhe a lista pelo título do catálogo (ou pelo nome da pasta, se houver "2").

### XDBF (Xbox 360)

Big-endian, conforme o `xdbf_utils` do Xenia:

- Seção 1, metadados: `XACH` (conquistas) e `XSTC` (idioma padrão).
- Seção 2, imagens PNG: o ícone de cada conquista e o do título (`0x8000`).
- Seção 3, textos: um bloco `XSTR` por idioma.

Os textos saem em português quando o jogo tem; senão em inglês; senão no idioma padrão do jogo.

### Executáveis

- **XEX2** sem criptografia, com compressão "nenhuma" ou "básica": é o que o UnleashedRecomp grava em `patched/`.
- **Imagem descriptografada do MarathonRecomp**: cabeçalho LE `0xDECDECDE`, `base`, `entry`, `resource_offset`, `resource_size` (36 bytes), seguido da imagem crua.

## Conquistas raras

Quando a origem publica a porcentagem de jogadores de cada conquista (Steam, GOG e o Recompia), o Cosmo guarda esses números e os atualiza a cada 3 dias. Uma conquista que menos de 5% dos jogadores têm é **rara**:

- **No Cosmo:** o aviso sai em roxo e ciano, com a porcentagem e um som próprio.
- **Por cima do jogo:** se o jogo está aberto, aparece um aviso próprio, com o ícone da conquista. As conquistas comuns não aparecem por cima do jogo.

Se a porcentagem ainda não estiver guardada quando a conquista sai, o Cosmo tenta buscá-la na hora, esperando no máximo 4 segundos. Sem porcentagem, a conquista é avisada como uma conquista comum.

## Desinstalar, remover e reinstalar

- **Desinstalar** apaga os arquivos do jogo, mas ele continua na biblioteca como "não instalado", com o tempo de jogo, as sessões e as conquistas. Antes de apagar, o Cosmo anota como reconhecer o jogo depois (`match_keys`): o appid da Steam (do `appmanifest` ou do crack), o id da GOG e o nome do `.exe` (menos os genéricos, como `Game.exe` ou `UnityCrashHandler64.exe`).
- **Reinstalar** volta para a mesma entrada: pelo catálogo (o "Instalar de novo" reaproveita até a mesma pasta, com os saves que ficaram nela), por "Já instalei de novo: mostrar a pasta" ou ao adicionar a pasta nova, que é reconhecida pelas chaves acima. Como o crack pode ser outro, o leitor de conquistas é escolhido de novo; as conquistas só se somam, nunca somem.
- **Remover da biblioteca** pergunta o que fazer:
  - *Só tirar da biblioteca*: o jogo some da lista, mas tudo fica guardado (`hidden_at`) e volta se ele for instalado ou adicionado de novo.
  - *Apagar tudo*: apaga o tempo de jogo e as conquistas do Cosmo e manda para a Lixeira as pastas de saves e conquistas do crack que ele conhece fora da pasta do jogo (`GSE Saves`, `Goldberg SteamEmu Saves`, `CODEX` e `RUNE`). Saves que o jogo guarda em outros lugares não são mexidos.

## Limitações conhecidas

- **XEX do disco**: vem criptografado e com compressão LZX, e o Cosmo não lê. Usamos o executável que o recomp gerou na instalação. Se a pasta `patched/` ou `decrypted/` não existir, a tela mostra o erro e os desbloqueios continuam sendo lidos (sem nome).
- **Mods que mudam a pasta do save** (o mod loader do UnleashedRecomp e o `redirectSave` do RSDK) ainda não são seguidos.
- **Sonic 1 × Sonic 2 no RSDKv4**: a escolha é por título ou nome da pasta, não pelo `Data.rsdk`.
- O Cosmo observa o arquivo por *polling* a cada 1,5 s. Isso funciona mesmo quando o arquivo ainda não existe e quando o jogo grava por renomeação.

## Licenças das listas embutidas

- `src/main/achievements/data/sonic3air.ts`: nomes e descrições das conquistas do Sonic 3 A.I.R., do código do projeto (GPL-3.0, Eukaryot).
- `src/main/achievements/data/rsdk4.ts`: nomes das conquistas do Sonic 1/2 (2013), do `RetroEngine.cpp` do RSDKv4-Decompilation (RSDKModding; RSDK original de Christian "Taxman" Whitehead; licença própria do projeto, uso não comercial).

São só textos de dados, citados com a fonte. Se o Cosmo for distribuído, vale confirmar com os autores ou trocar para leitura em tempo de execução a partir dos arquivos do próprio jogo.
