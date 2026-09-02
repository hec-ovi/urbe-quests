Cast
- Yara Fenn binds to mall_vendor. Fixed identity. Persona: prices anything in a second, never asks what it's for, until she has to.
- Milo Draeger binds to transit_agent. Fixed identity. Persona: checks serials twice out of habit, not suspicion, until the habit finds something real.

Artifacts
- The chit (valuable): a ration top-up with a serial that shouldn't still exist. Means the batch it came from was supposed to be gone.
- The stim kit (substance): what Yara keeps under the counter for exactly this. Means the difference between an ambulance and a clinic that doesn't ask.
- The batch reading (information): what the serial actually traces to. Means the route, not just the object.

Acts
1. The Stall: a chit that shouldn't exist changes what Milo thought he was buying.
2. The Reckoning: someone pays for the batch before anyone can decide who's guilty.

Steps
Act 1 (The Stall):
- Yara Fenn wants a fair price and no questions, which is exactly what breaks. Goto Sump Exchange.
- Yara Fenn wants to move the chit before it's traced to her stall; hands over the chit and the stim kit. Talk to Yara at Sump Exchange.

Act 2 (The Reckoning):
- Milo Draeger wants to know what he actually bought; needs the chit. Talk to Milo at the Harbor Junction booth.
- Yara Fenn wants the collapsed worker breathing before anyone decides whose fault it is; needs the stim kit. Deliver the stim kit to the Vitalis Spire Clinic.
- Milo Draeger wants to be the kind of agent who checks twice for a reason, not a habit; needs the batch reading. Talk to Milo at the booth; ending: Treated, Not Told.

## Manifest
roles: r_yara, r_milo
items: i3_chit (valuable), i3_meds (substance), i3_batch (information)
acts: d1_stall, d2_reckoning
endings: e3_treated
steps: s3_goto (goto), s3_ask (talk), s3_confront (talk), s3_deliver (deliver), s3_wrap (talk)