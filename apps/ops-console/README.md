# Ops Console

The Ops Console provides read-only operational visibility for MLGO platforms.
It allows operations and engineering staff to view the current registry of active deployments and inspect technical events associated with those deployments.

## Architecture & Principles
- **Read-Only**: The console is purely read-only and uses a deployment-centric data source pattern (`OpsConsoleDataSource`).
- **No Direct Mutation**: Mutations are handled via external CI/CD or M1 core systems, not through the UI.
- **Fixture-Driven**: Currently relies on schema-validated static fixtures mimicking deterministic behavior. Real backend integration is deferred to later milestones.
- **Agnostic State**: Gracefully handles error boundaries, empty states, and loading indicators securely without relying on Vercel APIs.

## Commands

```bash
# Start development server
pnpm run dev

# Build for production
pnpm run build

# Run end-to-end tests
pnpm run test
```
