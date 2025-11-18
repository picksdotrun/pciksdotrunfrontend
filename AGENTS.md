# Repository Guidelines

## Project Structure & Module Organization
- `src/`: React app source. Entry `src/main.jsx`, root component `src/App.jsx`.
- `src/components/`: Reusable UI components (PascalCase filenames, default export matches filename).
- `src/lib/`: Utilities, API clients, and hooks (add as needed).
- `public/`: Static assets served as-is.
- Config: `vite.config.js`, `tailwind.config.js`, `eslint.config.js`.
- HTML shell: `index.html`. Styles: `src/index.css` (Tailwind).

Example: `import Header from './components/Header'`

## Build, Test, and Development Commands
- `npm run dev`: Start Vite dev server (HMR) at `http://localhost:5173`.
- `npm run build`: Production build to `dist/`.
- `npm run preview`: Preview the production build locally.
- `npm run lint`: Lint JavaScript/JSX with ESLint.

Tip: After changes to env or deps, restart `npm run dev`.

## Coding Style & Naming Conventions
- Indentation: 2 spaces. Use modern ES modules and React function components.
- Components: PascalCase files (`PlayerGrid.jsx`) and matching default export.
- Variables/functions: `camelCase`. Constants: `UPPER_SNAKE_CASE` if shared.
- Hooks: Prefix with `use` (e.g., `usePlayers`), colocate near usage or in `src/lib`.
- Styling: Prefer Tailwind utility classes; keep global CSS minimal in `index.css`.
- Linting: ESLint (recommended + react-hooks + react-refresh). Run `npm run lint` and fix warnings.

## Testing Guidelines
- No test runner is configured yet. Recommended: Vitest + React Testing Library.
- Placement: colocate `Component.test.jsx` next to components or under `src/__tests__/`.
- Scope: cover rendering, props, and basic interactions. Aim for meaningful tests over coverage percentage.
- Command (once added): `npx vitest` for watch; `npx vitest run` for CI.

## Commit & Pull Request Guidelines
- Commits: Use Conventional Commits for clarity.
  - Examples: `feat(ui): add AddPlayerModal`, `fix(grid): correct selection toggle`.
- Branches: `feature/<scope>`, `fix/<scope>`, `chore/<scope>`.
- PRs: include summary, linked issues, screenshots/GIFs for UI, and test steps.
- Quality gate: run `npm run lint` and `npm run build` before requesting review.

## Configuration & Security
- Copy `.env.example` to `.env.local`; never commit secrets. Vite only exposes vars prefixed `VITE_`.
- Supabase: use the anon key in client code; restrict data with RLS on the backend.
