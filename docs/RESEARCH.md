# Research conclusions (2026 survey)

What the quests box builds on. Full sourced findings live outside the repo; this is the distilled design input.

## Quest generation
- The LLM writes prose, code owns state. Every system that shipped (Hidden Door, NVIDIA ACE titles, academic pipelines) validates structure in code and never lets the model decide quest state.
- Two-tier generation: the whole story backbone (main line plus side premises) in one focused call, then each questline elaborated separately. Generating the backbone at once is what keeps quests consistent with each other.
- Persist raw LLM text before validation; repair with a follow-up call instead of regenerating.
- Narrative fields come before structural fields in every output schema (premise and motivation before steps and flags): key order decides whether the model plans before committing. Prompt-level format pressure hurts creativity more than real constrained decoding does.
- Never demand exact counts from the model, give ranges: quota pressure causes format overfitting at the cost of story quality.

## Quest flow
- Representation: condition-gated DAG of typed step nodes (the Godot Questify and Skyrim stage pattern), grouped in acts, with exclusive branches for diverging endings. Simplest to serialize, no LLM anywhere in it.
- Edges carry pure predicates (flag checks, step outcomes); flags are the only persisted state; transitions are code.
- Availability windows are predicates evaluated on demand against the simulation routine, never stored state: "giver on duty at this parcel now" is an enter condition, not a schema field.
- Role indirection (the Skyrim alias pattern): quest steps reference roles resolved at build time by type through simulation queries, never NPC ids or coordinates.
- Step kinds are a discriminated union with per-kind params, so era-fitting variants (hacking vs camel delivery) are a data and prompt question, not a code question.

## NPC memory and dialog context
- Per-NPC entity knowledge graphs lose to flat scored memory in benchmarks and in production trajectories; the questline graph itself (nodes with preconditions and postconditions) is the graph worth having. NPC knowledge is a scoped, flag-gated fact store.
- Memory retrieval: recency decay plus importance (1 to 10) plus relevance, the generative-agents formula that commercial systems (Convai) independently converged on. Summarization tiers: recent turns verbatim, older windows summarized, long term consolidated.
- Hallucination and secrets: prompt instructions, fine-tuning and RAG all fail at secret keeping (measured 10 percent leakage against handcrafted injections). A fact absent from the prompt cannot leak: quest knowledge enters the NPC context only when its flag unlocks, and deflection is the NPC genuinely not knowing.
- Context layering is dictated by prompt caching (prefix match): shared world lore, then type boilerplate, then per-NPC facts, then memory digest, then conversation. Per-NPC data never goes in the shared prefix.
