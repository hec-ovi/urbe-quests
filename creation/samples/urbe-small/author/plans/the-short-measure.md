## 1. Cast
- Nell Arden (r_nell): the courier who weighed the canisters. She wants someone she trusts to see what she saw, because she will not break a seal alone. Binds to Clinical Worker; characterName Nell Arden; any clinic worker of that kind will do, met at work at the Vitalis Spire Clinic. Persona: quiet, precise, counts in grams; says what her arms tell her and asks the player to look with her.
- Hale Mercer (r_hale): the precinct guard at Apex Oversight who owes Nell a favour. He wants paper he can walk up a staircase, a case that lands on the right desk. Binds to Security Worker; characterName Hale Mercer; any precinct guard will do, met at work at Apex Oversight. Persona: flat and slow, a pause before every promise, never promises what he cannot carry upstairs.

## 2. Artifacts
- The short measure (information, i_short): what Nell tells the player at the clinic: every sealed canister stamped at Weir Exchange weighs ten and a half litres against a seal that says twelve. It means the skim happens between the counter and the clinic.
- The tally book (document, i_tally): Orrin Pike's stamped tally book, left on the shelf behind the Weir Exchange counter. Two columns of what the seals say and what went out, and a third column of where the difference goes. It means proof enough for a clerk.

## 3. Acts
1. a_measure, The Measure: the player learns the measure is short and finds where it is written down. Once it is over, the skim is on paper.
2. a_first, Who Hears First: the paper goes up the staircase at Apex Oversight. Once it is over, the precinct owns the story.

## 4. Steps
Act a_measure:
- s_weigh (talk): Nell Arden wants someone she trusts to know the canisters weigh short; if nobody else knows, she is the courier who looked away. Talk to Nell at the Vitalis Spire Clinic. Gives i_short.
- s_tally (pickup): Nell wants the proof that the skim is written somewhere; without it her arms are the only witness. Pick up the tally book at Weir Exchange. Needs i_short, gives i_tally.

Act a_first:
- s_report (deliver): Hale Mercer wants paper he can walk up a staircase; without it the case never leaves his desk. Deliver the tally book to Apex Oversight. Needs i_tally; ends the questline in e_upstairs.

Ending e_upstairs, Paper Up the Staircase: the tally book goes up the staircase at Apex Oversight, the Weir Exchange counter gets a new clerk, and the canisters reach the clinic full. The barrel at Sluice Grub stops coming.

## Manifest
roles: r_nell, r_hale
items: i_short (information), i_tally (document)
acts: a_measure, a_first
endings: e_upstairs
steps: s_weigh (talk), s_tally (pickup), s_report (deliver)
