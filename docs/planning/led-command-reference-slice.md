# LED Command Reference Slice

This checklist verifies the complete simulated LED command loop: a Dashboard
request reaches the backend, the adapter dispatches it to the simulator, and
the resulting device fact returns through the normal projection and realtime
path. A requested power state is never evidence of confirmed device state.

## Verification Commands

Run these before treating the slice as complete:

```bash
npm --prefix simulator test
npm --prefix backend test
npm --prefix frontend test
npm run typecheck
npm run lint
npm run format
```

## Local Manual Scenario Checklist

Run the backend and frontend locally with `npm run dev`. Open **Dev scenarios**
on the Main LED card, choose a scenario, then use the LED power control once.
Set the scenario before sending each command; it applies to the next simulated
LED command only.

1. Choose **Confirm immediately**, request the opposite power state, and confirm
   that the control shows the request only until the reported state changes.
   Confirm that the card then shows the reported state and a `confirmed` outcome.
2. Choose **Confirm after 2 seconds**, request the opposite power state, and
   confirm that the old confirmed state remains visible while the request is
   pending. After roughly two seconds, confirm the reported state changes and
   the outcome becomes `confirmed`.
3. Choose **Reject command**, request the opposite power state, and confirm that
   the reported state does not change while the card shows an understandable
   failure outcome.
4. Choose **Do not confirm**, request the opposite power state, and confirm that
   the old reported state remains visible. After roughly five seconds, confirm
   the outcome is `timed_out` and remains understandable on the card.
5. Choose **Report after timeout**, request the opposite power state, and wait
   for the timeout. Confirm the outcome is `timed_out`. After roughly one more
   second, confirm the reported LED state changes, but the existing command
   outcome remains `timed_out` rather than becoming `confirmed`.

## Completion Rule

The slice is complete when the automated runtime integration test and the five
manual flows above pass. The Dashboard must distinguish requested and confirmed
state, and a late matching report must update only observed device state.

## Acceptance Record

The local manual checklist was completed successfully on 2026-08-10 against the
direct simulator route. The simulator, backend and frontend test suites, plus
repository typecheck, lint and format checks, passed in the same verification run.
