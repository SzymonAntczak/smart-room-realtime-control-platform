# ADR: LED Command Transport and Operational Defaults

## Status

Accepted

## Context

Stage 3 adds the first controllable-device reference slice. It needs one
unambiguous frontend-to-BFF command boundary, a bounded waiting policy, a
bounded terminal-command projection and deterministic simulator scenarios.

The current realtime BFF stream is server-to-client SSE delivery. The accepted
JSON Schema transport ADR requires an explicit shared schema and boundary
validation for all transport input. Command confirmation must remain based on a
matching reported device state, not on request acceptance or adapter dispatch.

## Options Considered

- Send commands as HTTP requests while retaining the server-to-client SSE
  stream for room projections.
- Add a client-to-server realtime message direction.
- Defer the command slice until the realtime stream is migrated to SSE.

## Decision

The frontend sends user commands with `POST /room/commands`. Its TypeBox request
contract begins with the existing `SetPowerCommandRequest` shape. The BFF
validates the request at the HTTP boundary and returns the accepted or rejected
command outcome synchronously; a successful response means only that the
backend accepted the command. It is not confirmation that the LED changed.

An accepted request returns `202 Accepted` with `{ commandId, status: "accepted" }`.
Malformed transport input returns `400`; a structurally valid but unsupported
device or command request returns `422`; and a request that conflicts with an
active command returns `409`. Rejected outcomes contain `{ commandId, status:
"rejected", reason, message }`. An active-command conflict creates a terminal
`failed` command lifecycle fact and projection so it remains auditable; the
response `commandId` correlates that outcome without implying device confirmation.

`/room/realtime` remains server-to-client only. The BFF does not accept
application command messages on that stream. Accepted, pending and terminal
command projections reach the frontend through the existing validated realtime
snapshot-plus-delta path. The completed
[SSE BFF migration](adr-server-sent-events-realtime-bff.md) preserves this Stage
3 decision.

The backend timeout for `led` `set.power` commands is 5000 ms from dispatch.
The backend retains at most 20 terminal command projections in
`recentCommands`, newest first. After adding a terminal projection beyond the
limit, it removes the oldest projection. This in-memory list is not durable
history.

The LED simulator provides these deterministic device-native scenarios:

| Scenario               | Simulator behavior                                                              | Expected platform outcome                                       |
| ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `confirm_immediately`  | Emits the matching state report immediately after receiving the native command. | `confirmed`                                                     |
| `confirm_delayed`      | Emits the matching state report 2000 ms after receiving the native command.     | `confirmed` before timeout                                      |
| `reject_command`       | Explicitly rejects the native command without reporting a state change.         | `failed`                                                        |
| `omit_confirmation`    | Does not report a state change.                                                 | `timed_out` after 5000 ms                                       |
| `report_after_timeout` | Emits the matching state report 6000 ms after receiving the native command.     | The command remains `timed_out`; reported device state updates. |

The simulator owns only its native command response and report timing. The
backend owns command acceptance, dispatch, timeout, confirmation matching and
terminal projections.

Development scenario controls discover the five LED scenario names through the
device-scoped dev boundary. Selecting a scenario configures the behavior of the
**next** `set.power` command for `led-main`; it neither dispatches a command nor
changes reported LED state. The simulator consumes that selection when it
receives the command and returns to its configured default behavior. The runtime
rejects selection while that device has an `accepted` or `pending` command with
`409 scenario_conflict`; an already scheduled report or rejection is therefore
never cancelled. The scenario selection itself is dev-only, ephemeral runtime
configuration and is not included in room projections.

## Consequences

- HTTP provides a simple request/response boundary for BFF acceptance while
  preserving the SSE realtime stream and its tested reconnection model.
- The frontend must show `submitting` only until the HTTP response, then use
  realtime projections to show `accepted`, `pending` and terminal outcomes.
- A 5-second timeout makes delayed confirmation visible without keeping the
  device's sole active-command slot blocked for an excessive period.
- The fixed scenario timings make simulator, backend and UI tests repeatable.
- The 20-entry projection bound limits local memory but intentionally does not
  supply audit retention.
- The SSE realtime stream preserves the command boundary and realtime semantics.
- HTTP clients can distinguish malformed input, unsupported intent and active-command
  conflicts without treating any synchronous response as device confirmation.
- Dev tooling can demonstrate each command outcome without adding simulator
  behavior to the product command API or allowing the frontend to synthesize
  device state.
- A scenario must be selected before sending the LED command; it cannot alter
  the behavior of an in-flight command.

## Verification

- Shared HTTP schemas accept valid `set.power` requests and reject malformed
  requests at the BFF boundary.
- BFF tests distinguish synchronous acceptance or rejection from later
  realtime confirmation, failure or timeout projections.
- State-model tests enforce the 5000 ms dispatch-based timeout, one active
  command per device, exact power matching, newest-first retention of 20
  terminal outcomes and no reconfirmation after timeout.
- Simulator tests reproduce all five scenario identifiers and their documented
  timings without assigning platform lifecycle outcomes to the simulator.
- Frontend tests prove that a requested LED state is not rendered as confirmed
  before a matching report-derived realtime projection arrives.
- Runtime tests prove that selecting a LED scenario affects the next command
  only and rejects selection while an LED command remains active.

## Links

- Related architecture document: [System Context](../architecture/system-context.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related architecture document: [Reliability and Testing](../architecture/reliability-and-testing.md)
- Related decision: [JSON Schema Transport Contracts](adr-json-schema-transport-contracts.md)
- Related decision: [Command Correlation, Confirmation and Concurrency](adr-command-correlation-confirmation-and-concurrency.md)
- Related decision: [Command History and Terminal Projections](adr-command-history-and-terminal-projections.md)
