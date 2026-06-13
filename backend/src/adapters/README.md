# Backend Adapters

Adapters translate source-specific messages into platform events. They are the
boundary between simulator, hardware or external system shapes and the backend
platform contract.

## Contents

- `simulator/` contains adapters for simulator-native messages.

The current simulator temperature adapter is the first read-path translation
example. Detailed adapter rules live in `backend/AGENTS.md` and the architecture
docs.
