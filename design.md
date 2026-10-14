# animePLUS — Design System

Documento di riferimento per l'interfaccia. Descrive **ciò che esiste realmente nel
codice**, con i percorsi dei file, non un'aspirazione. Dove qualcosa manca o è
incompleto, è indicato esplicitamente.

Ultimo aggiornamento: dopo il restyling di card, home e pagina dettagli (commit `cb56d27`).

---

## 1. Principi

Tre regole che guidano le scelte fatte finora.

**1. Il colore viene dal tema, mai scritto a mano.**
Nessun componente contiene un colore fisso per la UI. Tutto passa da variabili CSS,
così cambiare palette cambia l'intera app. L'unica eccezione ammessa sono i colori
*semantici* (errore, avviso), che devono restare riconoscibili in ogni palette.

**2. Contrasto prima dell'effetto.**
Testo su immagine richiede sempre uno scrim. Il glass e i gradienti tenui sono
accettabili solo se il testo resta leggibile su key art chiara.

**3. Movimento decorativo, mai necessario.**
Tutte le animazioni sono opzionali: l'app è pienamente usabile senza. Sono
disattivate da `prefers-reduced-motion` (§7).

---

## 2. Colori

### 2.1 Come funziona il tema

Due livelli **ortogonali**:

| Livello | Meccanismo | File | Valori |
|---|---|---|---|
| Modalità | classe `.dark` su `<html>` | `styles/global.css` | light / dark / system |
| Palette | attributo `data-palette` su `<html>` | `styles/global.css` | default / steinsgate / frieren / cyberpunk |

`default` **non imposta l'attributo**, quindi applica i token base senza modifiche.
Questo garantisce che chi non sceglie nulla veda l'interfaccia originale.

Applicazione: `renderer/helpers/theme/theme-helper.ts`
- `applyStoredThemeClass()` — sincrona, eseguita all'import prima di React, evita il
  lampo di colori sbagliati
- `applyPalette()` / `applyStoredPalette()` — stessa logica per la palette
- Persistenza: `localStorage` chiave `"theme"` e `"theme.palette"`

> **Perché localStorage e non electron-store:** il valore deve essere leggibile
> *sincronicamente* al caricamento del modulo. electron-store è asincrono e
> causerebbe un flash della palette sbagliata.

### 2.2 Token base (`:root` / `.dark`)

Valori in HSL, **senza wrapper `hsl()`** — il wrapper è nel `tailwind.config.js`.

| Token | Chiaro | Scuro | Uso |
|---|---|---|---|
| `--background` | `0 0% 100%` | `240 10% 3.9%` | sfondo pagina |
| `--foreground` | `240 10% 3.9%` | `0 0% 98%` | testo principale |
| `--card` | `0 0% 100%` | `240 10% 3.9%` | superficie card |
| `--popover` | `0 0% 100%` | `240 10% 3.9%` | menu, dropdown |
| `--primary` | `240 5.9% 10%` | `0 0% 98%` | azione principale |
| `--secondary` | `240 4.8% 95.9%` | `240 3.7% 15.9%` | azione secondaria |
| `--muted` | `240 4.8% 95.9%` | `240 3.7% 15.9%` | superficie attenuata |
| `--muted-foreground` | `240 3.8% 46.1%` | `240 5% 64.9%` | testo secondario |
| `--accent` | `240 4.8% 95.9%` | `240 3.7% 15.9%` | hover, selezione |
| `--border` | `240 5.9% 90%` | `240 3.7% 15.9%` | bordi |
| `--input` | `240 5.9% 90%` | `240 3.7% 15.9%` | bordi input |
| `--ring` | `240 5.9% 10%` | `240 4.9% 83.9%` | anello focus |
| `--destructive` | `0 84.2% 60.2%` | `0 62.8% 30.6%` | errore, elimina |

### 2.3 Scala accent (introdotta col sistema palette)

| Token | Ruolo |
|---|---|
| `--accent-solid` | riempimento pieno col colore firma della palette |
| `--accent-solid-foreground` | testo sopra `--accent-solid` |
| `--accent-soft` | tinta tenue, per superfici attive/selezionate |
| `--accent-glow` | bagliore, bordi hover, anello attivo |
| `--highlight` | secondo colore della palette, per accenti |
| `--highlight-foreground` | testo sopra `--highlight` |

Esposti in Tailwind come `bg-accent-solid`, `text-accent-glow`,
`border-accent-glow`, `bg-accent-soft`, `text-highlight`, ecc.

> ⚠️ **Non esiste `--accent-glow-foreground`.** Un tentativo di usarlo produce una
> classe morta e testo trasparente. Sopra `bg-accent-glow` si usa `text-background`.

### 2.4 Le quattro palette

| id | Nome | Base | Accento | Highlight |
|---|---|---|---|---|
| `default` | Default | zinco neutro | bianco/nero | — |
| `steinsgate` | Steins;Gate | indaco `238 40% 8%` | indaco `238 72% 64%` | seppia `38 85% 66%` |
| `frieren` | Frieren | verde `165 32% 8%` | smeraldo `158 60% 54%` | oro `44 72% 68%` |
| `cyberpunk` | Edgerunners | blu notte `220 30% 8%` | giallo `57 92% 54%` | ciano `187 92% 52%` |

**Origine della palette Steins;Gate:** i colori sono stati **estratti dai pixel**
del banner e della cover ufficiali su AniList, non stimati a occhio. L'indaco 238
(il cielo di Tokyo al tramonto) è la tinta dominante. Dettagli in
`steinsgate-palette.md`.

> **Nota di stato:** le palette non soddisfano ancora l'utente e sono da rivedere.
> La struttura però è corretta e va mantenuta.

### 2.5 Sfondo ambientale

`body::before` disegna tre gradienti radiali molto tenui, tinti da
`--accent-glow`, `--highlight` e `--accent-solid`. Serve a rendere visibile la
palette: a luminosità 8% una tinta piatta appare nera.

> **Trappola nota:** qualsiasi contenitore con `bg-background` **opaco** sopra il
> gradiente lo cancella. `SidebarInset` e le titlebar avevano questo problema ed
> erano la causa per cui le palette sembravano non funzionare. Ora sono
> trasparenti (`bg-transparent`) o traslucide (`bg-background/75 backdrop-blur-xl`).
> **Se aggiungi un nuovo contenitore a tutta pagina, non dargli `bg-background`.**

---

## 3. Tipografia

Nessun font personalizzato: si usa lo stack di sistema (nessuna `font-family`
definita in `tailwind.config.js`, nessun `@font-face`). Questo mantiene l'app
leggera e nativa.

### Scala usata

| Ruolo | Classi | Dove |
|---|---|---|
| Titolo pagina | `text-4xl font-semibold tracking-tight` | `page-header.tsx` |
| Titolo hero dettagli | `text-3xl md:text-5xl font-bold leading-[1.1] tracking-tight` | `show-details-page.tsx` |
| Intestazione sezione | `text-lg font-semibold tracking-tight` | `section-heading.tsx` |
| Titolo card | `text-[13px] font-semibold leading-snug` | `show-grid.tsx`, `episode-card.tsx` |
| Corpo | `text-sm` | prevalente |
| Secondario | `text-sm text-muted-foreground` | descrizioni |
| Badge/etichetta | `text-[11px] font-semibold` | badge card |

### Regole

- **Mai `text-4xl` fuori da `PageHeader`.** Le pagine che lo scrivevano a mano
  avevano spaziature leggermente diverse; ora il titolo passa da lì.
- **`tracking-tight` sui titoli grandi**, mai sul corpo.
- **`line-clamp-2` sui titoli delle card**, `leading-snug` per non sprecare altezza.
- **`tabular-nums`** su tutti i numeri che cambiano (durate, progressi).

---

## 4. Spaziatura e layout

### 4.1 Contenitore pagina

```jsx
<div className="oa-page-enter w-full max-w-[1600px] mx-auto flex flex-col gap-6 p-6 md:p-8">
```

Larghezza massima **1600px**, padding `1.5rem` → `2rem` da `md`. Il gap tra sezioni
è **`gap-6`**.

### 4.2 Breakpoint

Tailwind standard, con questo uso reale nel codice:

| Breakpoint | px | Occorrenze | Uso tipico |
|---|---|---|---|
| `sm:` | 640 | 75 | griglie a 2-3 colonne |
| `md:` | 768 | 54 | padding pagina, layout orizzontale |
| `lg:` | 1024 | 14 | sidebar episodi, hero dettagli |
| `xl:` | 1280 | 9 | griglie a 6 colonne, Following |
| `2xl:` | 1536 | 0 | **non usato** |

### 4.3 Griglie

| Contesto | Classi |
|---|---|
| Ricerca | `grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4` |
| Episodi dettagli | `grid-cols-2 md:grid-cols-3 xl:grid-cols-4` |
| Following | `sm:grid-cols-2 xl:grid-cols-3` |

### 4.4 Caroselli orizzontali

`horizontal-carousel.tsx` — scroll orizzontale con frecce che compaiono solo se c'è
contenuto da scorrere, e frecce che **non coprono** le card (`left-2`, `right-2`
fuori dal padding).

---

## 5. Raggio, ombre, profondità

| Token | Valore | Uso |
|---|---|---|
| `--radius` | `0.75rem` | base |
| `rounded-lg` | `var(--radius)` = 12px | bottoni, input, card piccole |
| `rounded-xl` | — | card contenuto (implicito Tailwind 12px) |
| `rounded-2xl` | 16px | card poster |
| `rounded-full` | — | badge, pallini carosello |

**Z-index documentati:**

| Layer | z | Note |
|---|---|---|
| Gradiente ambientale | `0` | `body::before` |
| Contenuto app | `1` | `#app` |
| Canvas shader Anime4K | `1` | dentro il player, `pointer-events: none` |
| Controlli player videojs | `10` | **non coprire** — vedi §8 |
| Chrome player (top bar, badge) | `20` | |
| Overlay errore | `30` | |
| Menu select | `120` | |

---

## 6. Componenti

### 6.1 Primitivi UI — `components/ui/`

`avatar` · `badge` · `button` · `card` · `command` · `dialog` · `dropdown-menu` ·
`input` · `popover` · `select` · `separator` · `sheet` · `sidebar` · `skeleton` ·
`switch` · `tabs` · `textarea` · `tooltip`

**`card.tsx`** — introdotto per eliminare una duplicazione: il letterale
`rounded-xl border border-border p-5` compariva in ~20 punti.
Varianti: `default` / `outline` / `muted`; padding `none` / `sm` / `default` / `lg`;
prop `interactive` per l'effetto hover. Accetta `as="section"` per il markup semantico.

**`button.tsx`** — 6 varianti (`default`, `destructive`, `outline`, `secondary`,
`ghost`, `link`), 4 dimensioni (`default`, `sm`, `lg`, `icon`). La variante
`default` usa `.oa-sheen`.

### 6.2 Componenti applicativi

| Componente | Ruolo |
|---|---|
| `page-header.tsx` | titolo + descrizione + azione, con barretta accent. **Usare sempre** |
| `section-heading.tsx` | intestazione di sezione con barretta. Per liste impilate |
| `show-grid.tsx` | `ShowCard` + `ShowGrid`, card poster 2:3 |
| `episode-card.tsx` | card episodio, layout `carousel` o `grid` |
| `horizontal-carousel.tsx` | riga scorrevole con frecce |
| `home-hero-carousel.tsx` | hero a tutta larghezza in home |
| `palette-picker.tsx` | griglia di campioni colore |
| `theme-picker.tsx` | scelta chiaro/scuro/sistema |
| `anilist-list-controls.tsx` | stato lista + preferito |
| `titlebar-*.tsx` | barra finestra (Windows / macOS) |

### 6.3 Card contenuto — regole

Le card mostrano testo **sopra un'immagine**, quindi:

1. **Scrim a due stop obbligatorio**: `bg-gradient-to-t from-black/90 via-black/45 to-transparent`.
   Un solo stop lasciava il testo su key art chiara, illeggibile.
2. **Badge come pillola piena** (`bg-accent-glow text-background`), non vetro
   traslucido: il vetro spariva sulle immagini chiare.
3. **Altezza adattiva.** `EpisodeCard` aveva `h-40` fisso, troppo basso per badge +
   titolo su due righe: la seconda riga veniva tagliata.
4. **`object-cover` con proporzioni fisse** per le copertine (`aspect-[2/3]`).
   `h-64 w-auto` lasciava sbordare e tagliare le copertine più alte.

---

## 7. Movimento

**Nessuna libreria di animazione.** Solo CSS, in `styles/global.css`. Le classi
hanno prefisso `oa-` per non collidere con Tailwind.

| Classe | Effetto |
|---|---|
| `.oa-interactive-card` | solleva di 2px, bordo verso l'accent, ombra |
| `.oa-poster-card` / `.oa-poster-media` | zoom dell'artwork al 4.5% |
| `.oa-sheen` | riflesso che attraversa il bottone |
| `.oa-underline-sweep` | sottolineatura che cresce da sinistra |
| `.oa-page-enter` | fade + salita all'ingresso pagina |
| `.oa-stagger` | entrata a cascata; usare `style={{ "--oa-i": index }}` |
| `.oa-glow-ring` | anello con il colore accent |

**Keyframes:** `oa-fade-rise`, `oa-pulse-soft`.

### Accessibilità

```css
@media (prefers-reduced-motion: reduce) { ... }
```
Disattiva il movimento, **mantiene il feedback di colore** — così l'hover resta
percepibile anche senza animazione.

### Regole

- Durate: **200ms** per hover, **300ms** per entrate. Mai oltre 620ms (sheen).
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)`.
- **Animare `transform` e `opacity`**, non proprietà che causano reflow.

---

## 8. Player video

Il player è un sottosistema separato con vincoli propri. **Leggere prima di
modificare** — ci sono state regressioni qui.

### Vincoli non negoziabili

1. **L'elemento `<video>` non va sostituito.** Skin `@videojs/react`, controlli e
   `<track>` sottotitoli dipendono da lui.
2. **`requestFullscreen` promuove il root del player.** Qualunque cosa fuori da
   quell'elemento **smette di essere renderizzata** in fullscreen. Il canvas Anime4K
   è montato con un **React portal** dentro il player proprio per questo.
3. **I controlli sono a `z-index: 10`.** Il canvas shader a `z-index: 1`. Se il
   canvas sale a 10, copre la barra: resta cliccabile ma invisibile.
4. **videojs mostra i controlli su `pointermove` del container.** Il canvas deve
   stare *dentro* quel container, altrimenti è una zona morta e la barra non
   ricompare.
5. **Lo scrim `.media-overlay` è disattivato** (`display: none`): scuriva il video
   quando comparivano i controlli.

### Anime4K

- Preset: `off`, A, B, C, A+A, GAN. Default **`off`**.
- Il canvas è dimensionato sulla geometria reale del `<video>`, non stirato.
- Contestualizzato in `renderer/lib/anime4k-webgpu-renderer.ts`.

---

## 9. Convenzioni di codice

- **Import alias**: `@/renderer/...`, `@/shared/...`, `@/main/...`
- **Tipi condivisi** in `src/shared/types.d.ts` e file affiancati
- **Commenti**: spiegano *perché*, non *cosa*. Ogni scelta non ovvia ha il suo
- **Nomi file**: `kebab-case.tsx`
- **Stato**: `useState` locale; IPC per la persistenza
- **Hook**: prefisso `use-`, un file per hook in `renderer/hooks/`

---

## 10. Cosa manca / da rivedere

Onestà su ciò che non è finito.

| Elemento | Stato |
|---|---|
| **Palette e logo** | Non soddisfano l'utente, da rivedere |
| **Player e sidebar episodi** | Non ancora rivisti |
| **Nessun `Card` in `settings-page`** | Le sezioni usano `Card`, ma i pattern interni sono ancora eterogenei |
| **`--chart-1..5`** | Definiti ma inutilizzati (nessun grafico nell'app) |
| **`2xl:`** | Breakpoint mai usato nonostante `max-w-[1600px]` |
| **Tipografia** | Solo stack di sistema: nessuna identità tipografica propria |
| **Alto contrasto** | Non supportato (`prefers-contrast`) |
| **Schermi stretti** | Layout pensato per desktop; sotto ~900px non testato |

### 10.1 Debito tecnico verificato

**Colori hardcoded fuori dalla palette** — non seguono il tema, quindi cambiando
palette restano identici. Sono 9 punti:

| File | Colore | Natura |
|---|---|---|
| `watch-video-player-shell.tsx:30` | `white/25`, `bg-white/[0.12]` | chrome player: **accettabile**, è sopra il video |
| `watch-video-player-shell.tsx:324,442,521-522` | `amber-400/30`, `amber-950/70` | avviso qualità: **semantico, corretto** |
| `anilist-list-controls.tsx:186,187,193` | stati lista | da valutare |
| `show-grid.tsx:64` | `orange-400` icona fiamma | **semantico** (punteggio) |
| `titlebar-windows.tsx:89` | `hover:bg-red-500` | pulsante chiudi: **convenzione di sistema** |

**Verdetto:** nessuno di questi è un bug. Il player e le icone semantiche *devono*
avere colori propri. Il punto da rivedere è `anilist-list-controls.tsx`, dove i
colori di stato potrebbero derivare dalla palette.

**Il player ha un tema proprio.** `watch-video-player-shell.tsx` usa
`bg-white/[0.12]`, `border-white/25`, `backdrop-blur-xl`: un design system
separato che **ignora le variabili CSS**. È una scelta difendibile (i controlli
stanno sopra il video, non sopra lo sfondo), ma va deciso consapevolmente: se in
futuro si vuole il player tinto dalla palette, è lì che si interviene.

---

## 11. Come verificare una modifica

L'app **non** va giudicata a occhio dal codice: gli screenshot reali hanno rivelato
problemi invisibili leggendo i file (copertine tagliate, testo troncato, palette
che non si applicavano).

```powershell
cd D:\animePLUS\animePLUS-main\desktop
npx tsc --noEmit -p tsconfig.json        # deve dare 0 errori

$env:NODE_ENV='production'
npx electron-forge package --platform=win32 --arch=x64
# output: out\animePLUS-win32-x64\animePLUS.exe
```

> **Trappola:** `npm start` avvia un dev server che **muore col processo padre**,
> rendendo impossibile l'automazione. Per verificare in modo affidabile usare la
> build pacchettizzata (autocontenuta) lanciata come processo distaccato.

### Checklist prima di committare

1. `npx tsc --noEmit` → 0 errori
2. Build pacchettizzata completata
3. Screenshot della schermata toccata, confrontato col precedente
4. Nessun colore scritto a mano (eccetto semantici)
5. Nessun `bg-background` su contenitori a tutta pagina (§2.5)
6. Animazioni disattivabili (§7)
