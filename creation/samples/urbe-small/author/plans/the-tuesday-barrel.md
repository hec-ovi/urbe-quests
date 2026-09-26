## 1. Cast
- Dessa Vey (r_dessa): the Sluice Grub vendor who sells clean water by the cup. She wants her regulars fed and her stall open, and today she wants someone to see what a cheap cup did before she says where hers come from. Binds to City Vendor; characterName Dessa Vey; the same person as in the main story, met at work at the Sluice Grub stall. Persona: warm and fast, a price in every sentence; goes thin and quiet when a question costs more than a cup.

## 2. Artifacts
- Where the barrel comes from (information, i1_barrel): Dessa tells the player her clean barrel comes stamped from Weir Exchange every Tuesday. It means she has been selling the clinic's missing measure back to her own street.

## 3. Acts
1. a1_cup, The Cheap Cup: the player walks into the aftermath of a bad cup at the stall and Dessa names where her barrel comes from. Once it is over, the street's clean water has an address.

## 4. Steps
- s1_arrive (goto): Dessa wants someone to see the dock hand on the pavement before the queue closes over him; if nobody sees, the next cheap cup is somebody's child. Goto Sluice Grub. Staged there from the start: a dock hand sitting on the wet pavement at the stall entrance, a stranger kneeling beside him holding his wrist. It clears once Dessa has talked.
- s1_ask (talk): Dessa wants the player to understand why she will not stop selling; telling costs her the barrel. Talk to Dessa at Sluice Grub. Gives i1_barrel; ends in e1_poured.

Ending e1_poured, Poured Free: Dessa tells the player the barrel comes stamped from Weir Exchange every Tuesday, then pours the dock hand a cup of hers and does not charge.

## Manifest
roles: r_dessa
items: i1_barrel (information)
acts: a1_cup
endings: e1_poured
steps: s1_arrive (goto), s1_ask (talk)
