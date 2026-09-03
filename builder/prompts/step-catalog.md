# Step catalog

Sixteen step kinds. Use only the ones the story needs and the world supports. Every example reads want, cost, change, then the step.

## goto (reach a place)
- Cyberpunk: a medic wants someone she trusts to see the flooded dock warehouse before the corpo cleaners do; if nobody sees it, the drowned stay unlisted. Reaching it makes the player a witness. Step: goto the warehouse.
- Medieval: a novice wants the shrine outside the wall visited on the saint's day in his stead; missing it costs him his place in the order. Step: goto the shrine.
- Modern: a whistleblower wants a meeting on level 4 of the parking garage, nowhere with cameras; being seen anywhere else ends her career. Step: goto the garage.

## observe (watch a district)
- Cyberpunk: a fab worker wants proof that drone traffic over the fields breaks pattern at night; without it his crew stays quiet and one more of them disappears. Step: observe the industrial district.
- Medieval: a stallholder wants to know which stalls pay the watch; guessing wrong costs her the stall. Step: observe the market square.
- Ancient: a priestess wants the procession route confirmed at dusk; a wrong turn shames the temple. Step: observe the temple quarter.

## talk (find a person and speak)
- Cyberpunk: a clinic medic wants to hand over a name, but only between patients at work, where nobody would think twice; at home she is watched. Step: talk to the medic at the clinic.
- Medieval: a tavern keeper wants a rumor carried to the right ears and speaks freely only behind the bar. Step: talk to the keeper at the tavern.
- Any era: a worker will not talk at home, only on shift, because home is where the family is. Step: talk to the worker at work.

## listen (sit near two people talking)
- Cyberpunk: a fixer wants to know what two executives say over lunch when they think the booth is empty; walking away with nothing leaves her paying for a lie. Step: listen to the two executives at the restaurant.
- Medieval: a smith's apprentice wants the steward's deal with his master overheard; if it is what he fears, he loses his trade. Step: listen to the steward and the smith at the tavern.
- Modern: a colleague wants the rumor confirmed from the two people who started it, on the train where they talk too loudly. Step: listen to the two colleagues.

## pickup (take a placed item)
- Cyberpunk: a barista wants the data chip she stashed under a market stall back before the stall changes hands; on it is the only recording of her brother's last night. Step: pickup the chip.
- Medieval: a widow wants the sealed letter left inside a chapel bench, her husband's last confession, before the priest finds it. Step: pickup the letter.
- Ancient: a harbor clerk wants the amphora seal retrieved from the harbor master's post; without it a shipment and his name are lost. Step: pickup the seal.

## deliver (bring an item to a place)
- Cyberpunk: a mechanic wants an unregistered car in his garage before dawn shift; if it is found on the street his brother goes back inside. Step: deliver the car to the garage.
- Desert era: a weaver wants her cloth on the caravan before it leaves the district; missing it is a season's work unpaid. Step: deliver the camel's load to the caravan district.
- Aviation era: a farmer wants the crop plane landed quietly one district over, where the bank cannot see it. Step: deliver the plane to the field.

## steal (take what a person guards)
- Cyberpunk: an officer wants the keycard lifted from the security desk during rounds, because the desk belongs to the man who buried her report. Step: steal the keycard from the desk officer.
- Medieval: a guild widow wants the guild ledger taken from the counting room; in it is the debt that was never hers. Step: steal the ledger from the clerk.
- Modern: an engineer wants her prototype back from the trade show floor before the buyer signs. Step: steal the prototype from the salesman.

## assassinate (end someone)
- Cyberpunk: a fixer wants an executive to miss every future meeting; every meeting he attends costs someone in the tenements their home. Step: assassinate the executive.
- Medieval: a steward's victim wants him not to survive the harvest feast. Step: assassinate the steward.
- Use rarely; it is permanent, and the dead give no quests.

## work (take a job to gain access)
- Cyberpunk: a janitor wants someone on the night crew who can reach the restricted floors; he cannot, and what is up there is his daughter. Step: work a shift at the tower.
- Medieval: a tanner wants a hand hired on to enter the yard unseen, where the guild keeps what it took. Step: work a shift at the tannery.
- Modern: an assistant wants a temp at the front desk to learn the visitor log; her own name is on it. Step: work a shift at the front desk.

## investigation (inspect one authored clue)
- Cyberpunk: a medic wants the burn direction on a clinic wall recorded before the insurer paints it; without it a death remains an equipment fault. Step: investigate the exact burn clue, grant its information item, and set its completion flag.
- Medieval: a miller wants one blood trace under the grain chute inspected before the guild arrives; if missed, the apprentice takes the blame. Step: investigate that clue in the staged mill scene.
- Each clue is one step. Name its scene, evidence, information item, implicated roles, place, and completion flag.

## rescue (release one character)
- Cyberpunk: a dispatcher wants her partner released from a locked service cage; leaving him there lets the corporation erase the only witness. Step: rescue the named cast role through the exact release target.
- Medieval: a healer wants a prisoner freed from one set of stocks before the guard rotation. Step: rescue the named role at that place.
- Reaching safety is a later escort step.

## escort (follow or lead between places)
- Cyberpunk: a witness must follow the player from a clinic to a staffed safe office; losing her returns her to the people searching for her. Step: escort her on the named route from clinic to office.
- Medieval: the player follows a guide from the market to a concealed gate. Step: escort in `lead-player` mode.
- Name the cast role, route, mode, distinct endpoints, and completion flag. The host owns pathing and routine resumption.

## access (use an exact credential)
- Cyberpunk: a worker wants a service door opened with the code recovered from an earlier clue; the public entrance records faces. Step: access the named door with the information item.
- Medieval: a clerk wants an archive opened with a signet key before the records move. Step: access the named barrier with the key item.
- The credential must be a needed key, information item, or device.

## hacking (intrude on one supported target)
- Cyberpunk: a technician wants one terminal breached to recover a deleted route; without it the vanished shipment has no destination. Step: hack that terminal, give the information item, and set the completion flag.
- Near future: a controller wants one drone route rewritten to expose the illegal stop. Step: hack that controller.
- Use only when the era and target support digital intrusion.

## sabotage (change one authored target)
- Cyberpunk: a mechanic wants a relay disabled before it broadcasts a witness location. Step: sabotage that relay and set the consequence flag.
- Medieval: a stable hand wants one unmanned test carriage brake pin removed to prove the steward's fraud. Step: sabotage that named mechanism.
- This is an exact story-directed state change, not random destruction.

## transportation (complete a story-directed journey)
- Cyberpunk: a witness wants a named ride-hail from the market to the safe office; the street route is watched. Step: transport the player and witness between those places.
- Desert era: a healer wants medicine and its handler carried by camel from the oasis to the camp. Step: transport the exact passenger and cargo.
- Aviation era: a pilot wants one declared aircraft leg completed with a recovered package aboard. Step: transport by aircraft.
- Name the journey, mode, distinct endpoints, every passenger role, every physical cargo item, and completion flag.
