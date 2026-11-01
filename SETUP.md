# AI Explorer: Teacher & Organizer Setup Guide

This guide explains how to set up the **Cloud Firestore** backend and **Private Admin Console** (`admin.html`) for the 12th-grade AI & Tech Career workshop.

---

## 🎯 Architecture Overview

- **Student Website (`index.html`)**:
  - Zero-barrier participation: Students do not need Google logins, passwords, or personal apps.
  - Complete offline safety: If Wi-Fi drops, student responses are buffered securely in `localStorage` and auto-synced when reconnected.
  - Privacy preserved: No emails, phone numbers, exact marks, or addresses are collected.
  - Strictly no admin links: Students cannot navigate to or discover the admin page from the public app.

- **Admin Console (`admin.html`)**:
  - Hidden route with `<meta name="robots" content="noindex, nofollow">`.
  - Secure Firebase Email/Password authentication for session organizers and teachers.
  - Instant "Demo Mode" toggle for previewing analytics without live internet or before Firebase setup.
  - Real-time Firestore snapshot updates, Leaderboard, Career Distribution charts, and one-click CSV export.

---

## 🚀 5-Minute Firebase Setup (Free Tier)

### Step 1: Create a Firebase Project
1. Visit the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** (or **Create a project**).
3. Name it (e.g., `ai-explorer-workshop`).
4. Google Analytics is optional (you can disable it).
5. Click **Create project** and wait ~15 seconds.

---

### Step 2: Enable Cloud Firestore
1. In your Firebase project sidebar, click **Build** → **Firestore Database**.
2. Click **Create database**.
3. Choose a location closest to your school (e.g., `asia-south1` for India / Mumbai).
4. For security rules, select **Start in production mode** and click **Create**.

---

### Step 3: Enable Email/Password Authentication
1. In the sidebar, click **Build** → **Authentication**.
2. Click **Get Started**.
3. Under the **Sign-in method** tab, click **Email/Password**.
4. Toggle **Enable** (leave Email link / passwordless off).
5. Click **Save**.

---

### Step 4: Create Your Organizer Account
1. Inside the **Authentication** section, click the **Users** tab.
2. Click **Add user**.
3. Enter your teacher email (e.g., `teacher@school.edu`) and a strong password.
4. Click **Add user**. You will use this email and password to log in to `admin.html`.

---

### Step 5: Deploy Security Rules
1. In Firestore Database, click the **Rules** tab at the top.
2. Paste the contents of `firestore.rules`:

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /results/{resultId} {
      // Allow unauthenticated students in the workshop to submit quiz and profile results
      allow create: if request.resource.data.type in ['career_profile', 'knowledge_quiz']
                    && request.resource.data.studentId is string
                    && request.resource.data.studentId.size() > 0
                    && request.resource.data.studentId.size() <= 40
                    && request.resource.data.studentName is string
                    && request.resource.data.studentName.size() > 0
                    && request.resource.data.studentName.size() <= 50;

      // Allow reads, updates, and deletes ONLY for authenticated workshop administrators
      allow read, update, delete: if request.auth != null;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

3. Click **Publish**.

---

### Step 6: Add Your Firebase Web App Config
1. In the Firebase Console, click the **Gear icon (Project settings)** in the top left sidebar.
2. Under the **General** tab, scroll down to **Your apps** and click the **Web icon (`</>`)**.
3. Register the app (e.g., name it `AI Explorer Web`).
4. Firebase will display your `firebaseConfig` object, looking like this:

```javascript
const FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "ai-explorer-workshop.firebaseapp.com",
  projectId: "ai-explorer-workshop",
  storageBucket: "ai-explorer-workshop.appspot.com",
  messagingSenderId: "123456789...",
  appId: "1:123456789:web:abcdef..."
};
```

5. Open both `index.html` (around line 3374) and `admin.html` (around line 630).
6. Replace the placeholder `FIREBASE_CONFIG` values with your project credentials.

---

## 💻 Running the Workshop

### Local Testing & Preview (No Firebase Required!)
You can test the entire organizer experience right now without Firebase:
1. Open `http://localhost:3000/admin.html` in your browser.
2. Click **Preview in Demo Mode (Local Workshop Data) 🚀**.
3. You will immediately see:
   - 4 KPI metric cards with calculated averages.
   - Top 10 Knowledge Leaderboard with rank medals and completion times.
   - Pure CSS Career Domain Distribution bar chart.
   - Filter toolbar (by Stream, Class, Type, Search text).
   - "View Details" slide-over drawer showing individual student responses.
   - "Export CSV" generating a download of all session data.

### Running Live with Students
1. Share the link to `http://<your-host>:3000/` or your deployed URL with students.
2. Students draw their Explorer ID on the Guide tab, go through Prompt Gym, AI Tools, Domains, AI-Resistant Fields, and submit the **Career Profile Quiz** and **Knowledge Quiz**.
3. On your projector or teacher laptop, open `http://<your-host>:3000/admin.html`.
4. Sign in with your organizer account.
5. As students submit, results will appear in real time on the live dashboard.
6. At the end of the session, click **Export CSV** to download complete student reports for academic counseling.
