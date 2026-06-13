# Read Model

The read model owns backend projections derived from accepted platform events.
Future realtime API or BFF code should read these projections instead of
interpreting raw device-native messages.

## Contents

- Backend projections derived from accepted platform events.
- Tests for current projection behavior.

Projection semantics live in the architecture docs and accepted device and
command ADRs.
