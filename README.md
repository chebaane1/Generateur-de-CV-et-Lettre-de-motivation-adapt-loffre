# Générateur de CV et lettre de motivation (n8n + Gemini + Telegram + XeLaTeX)

Ce projet est un workflow d'automatisation n8n conçu pour générer instantanément un **CV adapté** et une **lettre de motivation (méthode Harvard)** au format PDF à partir d'une simple offre d'emploi envoyée sur Telegram.

---

## 🌟 Fonctionnalités

1. **Écoute Automatique (Polling Telegram) :** Vérifie régulièrement l'arrivée de nouvelles offres d'emploi ou de stage via un bot Telegram.
2. **Analyse & Adaptation via AI (Google Gemini 1.5) :**
   - **CV :** Adapte dynamiquement le profil, les compétences, les expériences et génère un projet sur-mesure parfaitement aligné avec l'offre (verbes d'action, métriques chiffrées, mots-clés techniques).
   - **Lettre de Motivation :** Rédige une lettre synthétique, ultra-percutante et personnalisée selon les standards de la *Harvard Business School*.
3. **Traitement JSON Robuste :** Nettoyage automatique des réponses de l'IA (suppression du Markdown, gestion des caractères Unicode invisibles).
4. **Compilation PDF via API XeLaTeX :** Envoie des données structurées à un microservice XeLaTeX dédié pour compiler deux PDF au rendu professionnel.
5. **Livraison Instantanée :** Envoi automatique des documents PDF générés directement dans le chat Telegram de l'utilisateur.

---

## 📐 Architecture du Workflow

```
[ Telegram ] 💬 (Offre reçue)
      │
      ▼
[ n8n Schedule Trigger ] ──► [ Polling API Telegram ]
      │
      ▼
[ Filtre & Code JS ] (Mise à jour de l'offset)
      │
  ┌───┴───────────────────────────┐
  ▼                               ▼
[ Message d'attente ]    [ Prompt Gemini 1.5 - CV ]
                                  │
                                  ▼
                         [ Nettoyage JSON JS ]
                                  │
                                  ▼
                         [ API XeLaTeX (CV) ]
                                  │
                                  ▼
                         [ Envoi PDF CV (Telegram) ]
                                  │
                                  ▼
                         [ Prompt Gemini 1.5 - Lettre ]
                                  │
                                  ▼
                         [ Nettoyage JSON JS ]
                                  │
                                  ▼
                         [ API XeLaTeX (Lettre) ]
                                  │
                                  ▼
                         [ Envoi PDF Lettre (Telegram) ]
```

---

## 🛠️ Stack Technique

- **Orchestration :** [n8n](https://n8n.io/)
- **Intelligence Artificielle :** Google Gemini API (`models/gemini-1.5-flash` / `gemini-1.5-pro`)
- **Messagerie :** Telegram Bot API
- **Génération PDF :** API REST basée sur **XeLaTeX** (Dockerized)
- **Langage & Scripting :** JavaScript (Nodes Code n8n)

---

## 📋 Prérequis

1. Une instance **n8n** en cours d'exécution.
2. Un bot Telegram créé via [@BotFather](https://t.me/BotFather) avec un token configuré uniquement dans n8n.
3. Une clé d'API **Google Gemini** configurée dans les credentials n8n.
4. Le service **XeLaTeX API** accessible sur votre réseau local/Docker (ex: `http://xelatex-api:8000`).

> Le workflow fourni est un template public. Il ne contient aucun token, credential, profil candidat ou identifiant personnel.

---

## 🚀 Installation & Configuration

### 1. Préparer les informations du candidat

Copiez `.env.example` vers `.env` :

```bash
cp .env.example .env
```

Sous PowerShell :

```powershell
Copy-Item .env.example .env
```

Ouvrez `.env` et remplacez chaque valeur `YOUR_*` :

| Variable | À remplacer par |
| --- | --- |
| `CV_NAME` | Nom affiché sur le CV et la lettre |
| `CV_LOCATION` | Ville et pays affichés |
| `CV_EMAIL` | Adresse e-mail professionnelle |
| `CV_GITHUB` | URL GitHub, sans `https://` obligatoire |
| `CV_LINKEDIN` | URL LinkedIn, sans `https://` obligatoire |
| `CV_COMPANY_1`, `CV_COMPANY_2`, `CV_COMPANY_3` | Noms des expériences professionnelles |
| `CV_PROJECT_URL` | URL d'un projet public |
| `CV_SCHOOL` | Établissement de formation principal |
| `CV_SECONDARY_SCHOOL` | Établissement secondaire, si nécessaire |
| `CV_DISTINCTION` | Distinction ou prix à afficher |
| `CV_COMMUNITY` | Association ou communauté technique |

Le fichier `.env` est ignoré par Git et ne doit jamais être publié. Les descriptions détaillées des expériences, compétences et projets sont envoyées par le workflow n8n, pas par `.env`.

### 2. Importer et personnaliser le workflow

1. Importez [workflow.template.json](workflow.template.json) dans n8n via **Workflows** > **Import from File / JSON**.
2. Dans le nœud **Get Telegram Updates**, remplacez `YOUR_TELEGRAM_BOT_TOKEN` par le token de votre bot.
3. Dans les nœuds **Generate Resume JSON** et **Generate Cover Letter JSON**, remplacez `YOUR_CANDIDATE_PROFILE` par votre profil, vos expériences, vos compétences et vos projets.
4. Faites ce remplacement dans les deux nœuds : le premier génère le CV, le second génère la lettre.
5. Conservez uniquement des informations que vous avez le droit de transmettre à Google Gemini.

Le workflow est désactivé par défaut (`active: false`). Testez-le manuellement dans n8n avant de l'activer.

### 3. Configurer les credentials n8n

Après l'import, associez vos propres credentials aux nœuds concernés :

- Nœuds **Generate Resume JSON** et **Generate Cover Letter JSON** : credential Google Gemini.
- Nœuds **Acknowledge Message**, **Send Resume PDF** et **Send Cover Letter PDF** : credential Telegram.

Les credentials doivent être créés directement dans n8n. Ne les ajoutez pas au fichier JSON et ne les commitez jamais dans Git.

### 4. Configurer l'API XeLaTeX

Copiez `.env.example` vers `.env`, complétez-le, puis démarrez les services :

```bash
docker compose up --build -d
```

Assurez-vous que vos nœuds `HTTP Request` pointent vers les bons endpoints de compilation :
- Compile CV : `http://xelatex-api:8000/compile-resume`
- Compile Lettre : `http://xelatex-api:8000/compile-cover-letter`

Si n8n tourne hors de Docker, remplacez `http://xelatex-api:8000` par `http://localhost:8000` dans les deux nœuds HTTP Request.

### 5. Vérifier avant publication

Avant de pousser le projet, vérifiez que :

- `.env` n'est pas suivi par Git (`git status` ne doit pas l'afficher).
- Le JSON ne contient plus `YOUR_TELEGRAM_BOT_TOKEN` ni de token réel.
- `YOUR_CANDIDATE_PROFILE` a été remplacé uniquement dans votre copie locale du workflow.
- Aucun PDF, log, message Telegram ou clé API n'est présent dans le dépôt.

---

## 📱 Utilisation

1. Envoyez un message contenant une **offre de stage ou d'emploi** (texte de plus de 20 caractères) à votre Bot Telegram.
2. Le Bot répond immédiatement : `"je m'occupe de cette offre ! Tkika ..."`.
3. Quelques secondes plus tard, vous recevrez successivement dans votre discussion :
   - Your **CV optimisé** en format PDF.
   - Votre **Lettre de Motivation** sur-mesure en format PDF.

---

## Sécurité

Ne placez jamais de token Telegram, clé Gemini, mot de passe ou offre d'emploi privée dans le dépôt. Si un secret a déjà été publié, révoquez-le puis nettoyez l'historique Git avant de rendre le dépôt public.

## Licence

Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.