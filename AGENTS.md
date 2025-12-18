# GSPC-NEXT: Context & Architecture Constraints (MASTER V2)

> **CRITICAL INSTRUCTION:**
> This project is a V2 rewrite located in `gspc-next/` inside the legacy repo `gspc2`.
> **Scope:** You have READ-ONLY access to `legacy_reference/` (created by the setup script). You must implement the logic of ALL files listed below into the new stack.

## 1. THE MASTER MIGRATION MAP (Full Coverage)

You must ensure the logic from these legacy files is ported to the V2 structure.

### 🔵 Backend API (PHP -> NestJS)

| Legacy File (`api/`) | Functionality | V2 Destination (`backend/src/`) | Implementation Notes |
| :--- | :--- | :--- | :--- |
| **`auth.php`** | Login, Register, Session Check | **`modules/auth/`** | Use `AuthService` & `AuthController`. Replace PHP Sessions with **JWT**. |
| **`data.php`** | Fetch Graph Nodes/Links | **`modules/graph/`** | Move logic to `GraphService`. **CRITICAL:** Replace HTTP polling with `GraphGateway` (Socket.io). |
| **`messages.php`** | Send msg, Get history, Poll msgs | **`modules/chat/`** | `ChatService` (Persistence) & `ChatGateway` (Real-time delivery). |
| **`relations.php`** | Friend/Beef/Crush logic | **`modules/relationships/`** | `RelationshipsService`. **Strictly** follow the state machine logic (e.g., Accepting 'Dating' deletes 'Crush'). |
| **`profile.php`** | Update Bio, Avatar, Pwd | **`modules/users/`** | `UsersController` (endpoints like `PATCH /users/me`). Use DTOs for validation. |

### 🟠 Frontend Assets & UI (Vanilla JS -> React)

| Legacy File (`public/`) | Functionality | V2 Destination (`frontend/src/`) | Implementation Notes |
| :--- | :--- | :--- | :--- |
| **`js/app.js`** | Main entry, Polling loop | **`App.tsx` & `store/`** | Replaced by React Lifecycle & Socket Event Listeners (`socket.on`). |
| **`js/graph.js`** | Three.js rendering logic | **`components/WorldGraph.tsx`** | Use `react-force-graph-3d`. Port the "Focus Mode" visual logic here. |
| **`js/ui.js`** | DOM manipulation (Sidebars) | **`components/hud/`** | Rewrite as React Components (`ProfilePanel`, `ChatWindow`). No jQuery/Direct DOM. |
| **`js/api.js`** | `fetch` wrappers | **`api/axios.ts`** | Use Axios with Interceptors (for JWT injection). |
| **`css/style.css`** | Global Styles | **`index.css`** | Port relevant styles (HUD layout, fonts). discard legacy PHP-specific styles. |

### 🟣 Configuration & Helpers (PHP -> TS)

| Legacy File (`config/`) | Functionality | V2 Destination | Implementation Notes |
| :--- | :--- | :--- | :--- |
| **`constants.php`** | **RELATION TYPE IDs** | **`common/constants.ts`** | **CRITICAL:** Must copy ID values exactly (e.g. BEEF=5) to maintain logic consistency. |
| **`db.php`** | DB Connection | **`.env`** | Use these credentials to configure TypeORM in `.env`. |
| **`auth.php`** | Session Config | **`modules/auth/`** | Replaced by JWT Strategy configuration. |
| **`csrf.php`** | CSRF Tokens | **`main.ts`** | Enable generic CSRF protection middleware in NestJS. |
| **`helpers.php`** | Utility functions | **`common/utils/`** | Only port logic logic needed (e.g. data formatting). Input sanitization is handled by NestJS Pipes/DTOs now. |
| **`version.php`** | App Version | **`constants.ts`** | Just a const string. |

### ⚪ Root Files

| Legacy File | Functionality | V2 Destination | Notes |
| :--- | :--- | :--- | :--- |
| **`index.php`** | Login Page (Entry) | **`pages/LoginPage.tsx`** | React Route `/login`. |
| **`dashboard.php`** | Main App (Protected) | **`pages/DashboardPage.tsx`** | React Route `/` (Protected by AuthGuard). |
| **`logout.php`** | Destroy Session | **`useAuthStore.ts`** | Client-side logout (clear token) + Optional Server-side blacklist. |
| **`favicon.svg`** | Site Icon | **`public/favicon.svg`** | Move to Vite public folder. |

## 2. Domain Logic Constraints
(Refer to previous instructions regarding Relationship Types and Directed/Undirected logic. This remains the single most complex part of the migration.)

## 3. Environment
* **Backend:** NestJS (Port 3000)
* **Frontend:** React + Vite (Port 5173)
* **DB:** MySQL 8.0
* **Cache:** Redis