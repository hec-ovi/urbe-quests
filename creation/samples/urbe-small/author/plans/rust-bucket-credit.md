## 1. Cast
- Tamsin Roe (r_tamsin): the Rust Bucket Eatery cook who pays for her kitchen water twice. She wants Hale Mercer to know what it costs, and will not climb the precinct staircase herself. Binds to City Vendor; characterName Tamsin Roe; any vendor at the eatery will do, met at work. Persona: sharp, short sentences, talks over the pass because the kitchen is loud.
- Hale Mercer (r_hale): the precinct guard at Apex Oversight, the same person as in the main story. He wants paper, or at least a number. Binds to Security Worker; characterName Hale Mercer; met at work at Apex Oversight. Persona: flat and slow, a pause before every promise.

## 2. Artifacts
- The price of the water (information, i3_price): what Tamsin tells the player: the eatery pays for its water once in ration chits at Weir Exchange and again by the cup when the ration runs dry. It means somebody is selling Sump Row its own water.

## 3. Acts
1. a3_price, Twice Paid: the player carries a kitchen's price from the eatery up to the precinct. Once it is over, Hale has started watching.

## 4. Steps
- s3_tamsin (talk): Tamsin wants the price carried to Hale; a cook seen at the precinct loses her suppliers. Talk to Tamsin at the Rust Bucket Eatery. Gives i3_price.
- s3_hale (talk): Hale wants a number he can write down; without it Sump Row is another story with no paper. Talk to Hale at Apex Oversight. Needs i3_price; ends in e3_watching.

Ending e3_watching, Somewhere Else to Eat: Hale writes the number down and says he will eat somewhere else for a month, which on that street means he has started watching.

## Manifest
roles: r_tamsin, r_hale
items: i3_price (information)
acts: a3_price
endings: e3_watching
steps: s3_tamsin (talk), s3_hale (talk)
