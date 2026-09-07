# Calendario Fabily

Webapp semplice e mobile-first che mostra un calendario di famiglia leggendo un feed iCal esterno. Pensata per essere aperta da un link condiviso su WhatsApp, senza login.

## Come funziona

- `index.html`, `styles.css`, `app.js` — pagina statica, nessun build step.
- `api/calendar.js` — funzione serverless (Vercel) che fa da proxy verso il feed iCal reale, evitando problemi di CORS e tenendo l'URL/token del feed fuori dal codice sorgente pubblico.
- `vendor/ical.min.js` — libreria [ICAL.js](https://github.com/kewisch/ical.js) (Mozilla), usata per interpretare correttamente il fuso orario del feed.

## Sviluppo locale

Serve Node.js e la CLI di Vercel:

```bash
npm install -g vercel
```

Copia `.env.example` in `.env.local` e incolla l'URL reale del feed iCal:

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
4. Fai deploy. Vercel assegna un indirizzo fisso tipo `https://calendario-fabily.vercel.app` — quello è il link da condividere su WhatsApp.
5. Ogni push su GitHub aggiorna automaticamente il sito pubblicato.

## Aggiornare i contenuti in futuro

Basta modificare i file statici (`index.html`, `styles.css`, `app.js`) e fare push su GitHub: Vercel ripubblica automaticamente. Il feed iCal si aggiorna da solo, senza bisogno di modifiche.
