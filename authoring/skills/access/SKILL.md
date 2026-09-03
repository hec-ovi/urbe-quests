---
name: access
description: "Adapts using an exact key, code, or access device at a named access point."
triggers:
  - "use an entry code"
  - "open a restricted access point"
kind: mechanic
mechanic: access
---

# Entry code and access

Use `access` when the player already holds a specific credential and must use it at a specific barrier.

- Target: one `accessPointId`, one declared `credentialItemId` of kind key, information, or device, one existing `place`, and one declared `completionFlag`.
- Completion event: `accessed` with the same access point, credential, and place ids.
- Preconditions: `needs` must include the credential. Other items, flags, completed steps, and cast state may add exact gates.
- State change: effects set the completion flag and any authored access consequence before later steps activate.
- Failure: a wrong code, key, device, access point, place, or failed gate does not progress or consume the credential.

Examples: enter a numeric service code at a tower door, present a signet key at a keep archive, or use a pressure-seal token at an orbital hatch. Obtaining the credential is a prior talk, investigation, pickup, steal, or hacking step.
