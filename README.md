# Calendario Fabily

Webapp semplice e mobile-first che mostra un calendario di famiglia leggendo un feed iCal esterno. Pensata per essere aperta da un link condiviso su WhatsApp, senza login.

## Come funziona

- `index.html`, `styles.css`, `app.js` — pagina statica, nessun build step.
- `api/calendar.js` — funzione serverless (Vercel) che fa da proxy verso il feed iCal reale, evitando problemi di CORS e tenendo l'URL/token del feed fuori dal codice sorgente pubblico.
- `api/events.js` — funzione serverless che salva/legge gli eventi aggiunti dalla famiglia (singoli o ricorrenti) su Vercel KV (un piccolo database Redis gratuito), condivisi con chiunque apra il link.
- `vendor/ical.min.js` — libreria [ICAL.js](https://github.com/kewisch/ical.js) (Mozilla), usata per interpretare correttamente il fuso orario del feed e per calcolare le occorrenze degli eventi ricorrenti creati dalla famiglia.

### Limiti noti degli eventi personalizzati (v1)

- Gli eventi "tutto il giorno" possono durare un solo giorno (non è supportato uno span multi-giorno).
- Modificare un evento ricorrente aggiorna l'intera serie (non è possibile modificare una singola occorrenza, solo eliminarla).
- L'eliminazione invece supporta le 3 opzioni tipiche di Apple Calendar: solo questa occorrenza, questa e le successive, o l'intera serie.
- Non c'è alcuna protezione per aggiungere/modificare/eliminare eventi: chiunque abbia il link può farlo.

## Sviluppo locale

Serve Node.js e la CLI di Vercel:

```bash
npm install -g vercel
```

Copia `.env.example` in `.env.local` e incolla l'URL reale del feed iCal (e, se vuoi testare gli eventi personalizzati in locale, le credenziali di un database Vercel KV):

```bash
cp .env.example .env.local
```

Avvia il server locale (serve sia i file statici sia la funzione `/api/calendar`):

```bash
vercel dev
```

Apri l'indirizzo mostrato in console (di solito `http://localhost:3000`).

## Pubblicazione

1. Crea un repository su GitHub e collegalo a questo progetto.
2. Vai su [vercel.com](https://vercel.com), accedi con GitHub e importa il repository.
3. Nelle impostazioni del progetto Vercel (Project Settings → Environment Variables), aggiungi `ICS_FEED_URL` con l'URL reale del feed iCal.
4. Nel pannello Vercel, vai su **Storage** → crea un database **KV** (Redis, gratuito) e collegalo al progetto: Vercel inietta automaticamente le variabili `KV_REST_API_URL` e `KV_REST_API_TOKEN` che `api/events.js` usa per salvare gli eventi.
5. Fai deploy. Vercel assegna un indirizzo fisso tipo `https://calendario-fabily.vercel.app` — quello è il link da condividere su WhatsApp.
6. Ogni push su GitHub aggiorna automaticamente il sito pubblicato.

## Aggiornare i contenuti in futuro

Basta modificare i file statici (`index.html`, `styles.css`, `app.js`) e fare push su GitHub: Vercel ripubblica automaticamente. Il feed iCal si aggiorna da solo, senza bisogno di modifiche.
