# Install & Run (Local)

## Prerequisites
- Node.js 18+ recommended
- Firebase CLI: `npm i -g firebase-tools`

## Configure project
- Edit `.firebaserc` and set your project id, or run `firebase use --add`

## Start emulators
From repo root:
```bash
firebase emulators:start --only firestore,functions
```

## Build Functions
```bash
cd backend-firebase-functions
npm i
npm run build
```

## Run Frontend
```bash
cd frontend-angular
npm i
npm start
```

## Node placeholder (later migration target)
```bash
cd backend-node
npm i
npm run dev
```
