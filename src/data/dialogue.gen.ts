/**
 * Every line in the game. Keys are stable; the reducer looks them up by key.
 *
 * Written by hand to TONE.md. Not generated - the `.gen.ts` suffix only marks
 * this as a content table for the lint config.
 *
 * Hard constraints, enforced by gauntlet:tone:
 *  - one array entry = one text box, 108 characters maximum
 *  - font is A-Z a-z 0-9 and  .,!?'"-:;/()  and space. Nothing else.
 *  - every human is an adult, the creatures are never sexualized, acts fade out.
 */

export const DIALOGUE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // -------------------------------------------------------------------------
  // Cold open - the Astacio kennels, the morning the news comes up the fen road
  // -------------------------------------------------------------------------
  intro: [
    "Fenmark. Rain. A kennel gate nobody has painted since the war.",
    "TABITHA ASTACIO: Marlow. There's a rider on the fen road and he's in the good black.",
    "ODD MARLOW: Then the king's dead.",
    "TABITHA: The king's dead. Aldous. Choked on a plum. Nineteen years of war and fruit got him.",
    "MARLOW: God rest him.",
    "TABITHA: God rest the plum. It did more in an afternoon than the rest of us managed in a decade.",
    "MARLOW: No heir.",
    "TABITHA: No heir. Eight houses, forty claimants, and not one of them can prove it on paper.",
    "One crown between them, and eight grudges older than the war, the wine, and the both of us.",
    "Three of them share a bed and a vote. Two have been in love for eleven years in total silence.",
    "And one of them puts men down at their own front doors with their coats still half on.",
    "MARLOW: And you're going out in that.",
    "TABITHA: I'm forty-four, I breed the best ferals in this county, and I have never been paid on time.",
    "If somebody's handing out a crown, I want to be in the room when they drop it.",
  ],

  // -------------------------------------------------------------------------
  // Starters
  // -------------------------------------------------------------------------
  starter_offer: [
    "MARLOW: Three left in the pen, and you take one. Your kennel, your rule, your problem.",
    "TABITHA: Winter, who screams. Baloo, who has never once had a thought. Plato, who despises me.",
    "MARLOW: Take the cat. He's the only one on this property who has ever been right about anything.",
    "TABITHA: Thirty years on this gate and you have not been useful for a single one of them.",
    "MARLOW: One useful thing, then. Whatever you come back as, that animal comes back fed.",
    "MARLOW: I will be checking. Now pick, you're letting the rain in.",
  ],
  starter_winter: [
    "You reach for the black and white husky. Winter screams.",
    "Not a bark. A full, ringing, theatrical scream, held for the room.",
    "TABITHA: She does that at rain, at doors, at me, and once at a duck.",
    "She has already decided the rest of my life is a tragedy she's agreed to appear in.",
    "MARLOW: She'll do. Nothing frightens a toll clerk like a dog with a stage career.",
  ],
  starter_baloo: [
    "The orange husky arrives at full speed with all four feet off the ground, a landslide with a tail.",
    "TABITHA: Baloo has never had a second thought. He is still working on the first one.",
    "He'll follow me into a river. Into a house fire. Into House Brack, if the door was open.",
    "MARLOW: Then don't leave doors open.",
    "TABITHA: He heard the word 'door.' Look at him. He'll be on that until Thursday.",
  ],
  starter_plato: [
    "The grey tabby does not come when called. He arrives when it suits him, which is now.",
    "TABITHA: Plato will not fetch. Plato will not be asked twice.",
    "He is correct about nearly everything and he would like that written down somewhere official.",
    "MARLOW: That's not a pet.",
    "TABITHA: No. That's a colleague, and he has opinions about my posture.",
  ],

  // -------------------------------------------------------------------------
  // Cass - the rival
  // -------------------------------------------------------------------------
  rival_intro: [
    "CASS: There you are. I've been in this yard since six, being charming at a man with a broom.",
    "MARLOW: It didn't take.",
    "CASS: Nothing ever does, Marlow, it's my whole appeal.",
    "CASS: You took the one that loses to mine. Don't pull that face - I didn't rig it.",
    "I waited to see which way you'd flinch. You've flinched that way since we were nineteen.",
    "TABITHA: Nineteen years and you still get here first and make it my fault.",
    "CASS: For the record, I'm glad it's you. Everyone else in this county is furniture with opinions.",
    "Eight badges, one crown. I'll see you at Vantry, and I'll be the one who's dry.",
    "CASS: Marlow. Save me the good chair.",
  ],
  rival_1: [
    "CASS: Dara locked you in, didn't she. She bars that door and calls it hospitality.",
    "I got the collarbone story, the cup with the tooth in it, and a very long look at the clock.",
    "Two badges to your one. I'm not gloating, I'm narrating, which we both know is worse.",
    "Beat me and I'll buy the pie at the Kell toll house. Lose and I'll buy it anyway.",
  ],
  rival_1_defeat: [
    "CASS: Ow. Fine. That's the pie, and I want it noted I paid without being asked.",
    "You're better than you were in the spring. That's a compliment and a problem, in that order.",
  ],
  rival_2: [
    "CASS: Here. Take it. Mourne paper, real seal, opens doors, and don't ask me how I got it.",
    "TABITHA: I'm going to ask how you got it.",
    "CASS: Then don't ask twice. You'll need it at Orrin, and you'd rather die than ask Thistle.",
    "Nineteen years. I have never once let you walk into a room blind. Remember that bit.",
    "Now fight me, and stop looking at me like I've done something.",
  ],
  rival_2_defeat: [
    "CASS: God, you're good when you're angry. Keep the paper, I've got another.",
    "Whatever happens - and something is going to happen - remember that I gave you that.",
  ],
  rival_3: [
    "CASS: Don't. Whatever you're about to say, I've already said it to myself, and better.",
    "Yes. I sold Mourne your route. I sold Kell the flaw in the Astacio deed. Same week, same desk.",
    "I got House Mourne's backing and a seat at Ostmere. You got a barn that isn't yours.",
    "TABITHA: They killed Odd Marlow at my gate, Cass. Coat half on, the way Brack's people do it.",
    "CASS: I didn't know they'd send Brack's people.",
    "CASS: I'd have done it anyway. I want that on the record with the rest of it.",
    "I'm not sorry. I need that clear, because you'll spend years deciding whether I was.",
    "I'm not sorry. I'd do it again on a Tuesday.",
    "Now fight me. You've earned that much, and I've earned considerably worse.",
  ],
  rival_3_defeat: [
    "CASS: There. Do you feel better? No. Hitting me doesn't fix it. I checked, years ago.",
    "I'll be at Ostmere, in Mourne grey, hating the cut and wearing it anyway.",
    "You'll want to forgive me round about November. Don't.",
  ],
  rival_4: [
    "CASS: New coat. Mourne grey. Sera picked it, so it's a leash with buttons on.",
    "You send my letters back unopened. You read them first, though.",
    "I can tell, because they come back in a better envelope than the one they went out in.",
    "Go on. Ask me if it was worth it. I've got a beautiful answer and nobody left to say it to.",
    "Or fight me. Same conversation, fewer words, and I don't have to watch your face do that.",
  ],
  rival_4_defeat: [
    "CASS: Fine! You want the answer? It was worth it. I've been through the books, and it was worth it.",
    "I go through them most nights. That isn't regret, it's due diligence.",
  ],
  rival_5: [
    "CASS: Sera had me at her table on Thursday. I was seated below the fen wardens. Below them.",
    "Turns out the price of a friend is one chair, and the chair isn't even a good one.",
    "You are not allowed to be kind about this. I'll take anything else. Not that.",
    "Beat me again. It's the only conversation left that either of us is any good at.",
  ],
  rival_5_defeat: [
    "CASS: Yeah. Take it. I had something clever, but I spent it on Sera's steward this morning.",
    "I'll be at the door at Ostmere. Not to stop you. Just so you have to walk past me.",
  ],
  rival_final: [
    "CASS: Last door, and I got here first. That's the only thing I've won since March.",
    "I could tell you I did it for the house. Or the seat. Or that you'd have done it slower.",
    "I did it because I wanted it. And I wanted it more than I wanted you not to find out.",
    "That's the whole ledger. There's no apology at the bottom. There was never going to be one.",
    "TABITHA: Marlow used to say you'd end up somewhere warm and expensive.",
    "CASS: Marlow was right about most things and wrong about the important one.",
    "Now come through me. Properly. I'd hate for either of us to be gentle about it.",
  ],
  rival_final_defeat: [
    "CASS: Go on. She's through there. She's been ready since March, she was ready before he died.",
    "And don't send for me when they crown you. I'll know. The whole county will know.",
  ],

  // -------------------------------------------------------------------------
  // Gym 1 - DARA VANTRY, House Vantry. The morning after, to a locked-in guest.
  // -------------------------------------------------------------------------
  gym1_intro: [
    "DARA VANTRY: Sit. There. The chair's fine, the stain is older than you are.",
    "Door's barred till the tide turns, so you've got two hours and I have exactly one story.",
    "Drink that. No - the other one. That one's had somebody's tooth in it since Thursday.",
    "The Warden of the Cross-Fen left my bath at four this morning with a broken collarbone.",
    "He also had an apology written across his chest. Not in his hand: I hired a man who does weddings.",
    "He asked when he could see me again. I told him the Cross-Fen doesn't vote until August.",
    "That's House Vantry, sweetheart. Everything here is politics and a warm towel.",
    "Now hit me with everything you have, before I start talking about my brother.",
  ],
  gym1_defeat: [
    "DARA: Well. That's the first thing today that's gone a way I didn't arrange.",
    "Fen Badge. Vantry doesn't sulk, we just drink about it in a bigger room with better light.",
    "Come back Thursday. I'd like one person at my table who isn't counting my votes.",
  ],
  gym1_after: [
    "TABITHA: So. The Warden. How was he?",
    "DARA: He cried. Twice. Once for a good reason.",
    "TABITHA: Dara.",
    "DARA: My twin has been dead eleven weeks and not one soul in this fen will say his name at me.",
    "So instead they send me wardens, warm ones, to take my mind off it. It's thoughtful and it isn't working.",
    "Don't look at me like that. Go and win something and shut my door on the way out.",
    "DARA: His name was Aubrey. Ask me in August. I'll be able to do it in August.",
  ],

  // -------------------------------------------------------------------------
  // Gym 2 - MARGIT KELL, House Kell. Transactional and profoundly bored.
  // -------------------------------------------------------------------------
  gym2_intro: [
    "MARGIT KELL: Challenge fee is forty crowns. The badge is free. Nobody has ever found that funny.",
    "House Kell holds the tolls, the mint, and four of the eight houses' outstanding debt.",
    "I've read your file. Nine crowns, a bad coat, and an animal you've given a name to.",
    "Everyone gets round to asking who I sleep with, so: Dace, who runs a barge, on Tuesdays.",
    "He's gone by six and I get my entire Wednesday back. That is what an arrangement is for.",
    "Right. Battle. Try to be interesting - I have the Ottrey ledgers at noon and they're better company.",
  ],
  gym2_defeat: [
    "MARGIT: Hm. Fine. Toll Badge. I'll enter the loss on a page nobody reads.",
    "You've cost me forty crowns and the only interesting hour I've had since the funeral.",
    "Don't come back for a rematch. Come back when you own something I want.",
  ],
  gym2_after: [
    "MARGIT: Vantry owes me eleven thousand. Orrin owes me a favour, which is considerably worse.",
    "When the succession is called, seven houses will stand up and make speeches about honour.",
    "I'll stand up and read out what they owe. Guess which one empties the room.",
  ],

  // -------------------------------------------------------------------------
  // Gym 3 - THISTLE ORRIN, House Orrin. Magnificent. Waiting. Furious about it.
  // -------------------------------------------------------------------------
  gym3_intro: [
    "THISTLE ORRIN: Before you speak: yes, I know. I look devastating. It is a full-time position.",
    "You've come up from Kell, so you smell of money and disappointment. Sit further away.",
    "House Orrin holds the mountain road and the only tailor worth the trip south of the fen.",
    "Wren Halloway wrote to me this morning. Four lines. Three of them were about drainage.",
    "Eleven years. I've buried a father, outlived a husband and learned Ottreyan in eleven years,",
    "and that man has said 'you look well' to me one hundred and forty-one times.",
    "So we're going to fight, because if I stand still another minute I'll write back.",
  ],
  gym3_defeat: [
    "THISTLE: Good. Genuinely. I hate a soft opponent almost as much as I hate a soft letter.",
    "Ridge Badge. Wear it where Halloway can see it, and tell him exactly where you got it.",
    "Tell him I was magnificent. Don't embellish. There is no need to embellish.",
  ],
  gym3_after: [
    "THISTLE: If Wren asks me to dinner, I'll say yes so fast it will humiliate us both publicly.",
    "If Wren asks for the mountain road instead, Orrin closes it and Halloway starves by spring.",
    "Same man. Same evening. It really does come down to which sentence he picks.",
    "TABITHA: And if he picks neither?",
    "THISTLE: Then I'll have been right for twelve years, and I'll hate every hour of being right.",
  ],

  // -------------------------------------------------------------------------
  // Gym 4 - AUGUSTINE PELL, House Pell. The county surgeon. Immune to all of them.
  // -------------------------------------------------------------------------
  gym4_intro: [
    "AUGUSTINE PELL: Mind the bucket. That's the Warden of the Cross-Fen and he wants it back.",
    "I'm Pell. House Pell sews up whatever the other seven do to each other after the wine.",
    "I have seen every leader in Fenmark naked, unconscious, and full of somebody else's brandy.",
    "It cured me entirely of wanting any of them, which makes me the only honest vote in the county.",
    "Vantry's grieving and won't say it. Orrin's in love and won't stop. Brack is simply hungry.",
    "Now. Your animal has a hairline crack in the left foreleg and you hadn't noticed. Sit.",
    "There. Splinted. Three days of light work and no ledges, and I'll know if you cheat.",
    "Then we fight. I don't lose often, and when I do it's deliberate and it's for money.",
  ],
  gym4_defeat: [
    "PELL: That wasn't deliberate and nobody paid me. Well. That's a new column in the ledger.",
    "Bone Badge. And take this - powdered willow, three days, and don't argue dosage with me.",
    "You're the fourth person this year to beat me and the first one still breathing.",
  ],
  gym4_after: [
    "PELL: Brack's people brought me a man last month with his coat still half on.",
    "Four inches in, under the arm, angled up. That isn't a brawl. That's a technique.",
    "Somebody in this county is teaching that stroke, and charging good money by the lesson.",
    "When you work out who, come back and don't tell me. I'd like to keep sleeping.",
  ],

  // -------------------------------------------------------------------------
  // Gym 5 - WREN HALLOWAY, House Halloway. Twelve hundred spears. One unsent line.
  // -------------------------------------------------------------------------
  gym5_intro: [
    "WREN HALLOWAY: You've come from Orrin. Don't. Whatever she said about me, I don't want to hear it.",
    "I have held this pass against two armies and one winter that killed better men than both.",
    "I have a letter here. Four lines. Three about drainage, which is a real and serious issue.",
    "The fourth one I crossed out. Twice, so it couldn't be read against the light.",
    "It said 'come for dinner.' That was too much.",
    "House Halloway. Twelve hundred spears, one road, no wine worth the theft.",
    "Fight me. I'm very good at this, and it's the only thing I have never once overthought.",
  ],
  gym5_defeat: [
    "WREN: Clean. You went round my flank like somebody was paying you by the yard. Pass Badge.",
    "You'll tell Thistle, because everyone tells Thistle everything. That's fine. It's how the north works.",
    "Tell it exactly as it happened. Don't make me sound brave. It only encourages the county.",
  ],
  gym5_after: [
    "WREN: If I ask and it's no, I've lost eleven years and a mountain road in the same evening.",
    "If I ask and it's yes, Orrin and Halloway hold the whole north between them,",
    "and six houses start planning a wedding they will all sincerely try to poison.",
    "I am not a coward. I'm simply very good at arithmetic.",
    "TABITHA: Wren. She's learned an entire language while she waited.",
    "WREN: I know. I sent for the dictionary.",
  ],

  // -------------------------------------------------------------------------
  // Gym 6 - LEONORE ASHGROVE, House Ashgrove. One third of the bloc, and delighted.
  // -------------------------------------------------------------------------
  gym6_intro: [
    "LEONORE ASHGROVE: Come in, mind the step, and don't touch Sera's coat. She counts the buttons.",
    "Yes, it's true. Me, Sera Mourne and Hollis Brack, all three of us, and openly since the thaw.",
    "Three houses, one arrangement, one vote. Two short of a majority, and nobody sleeps well.",
    "And no, it isn't for the alliance. The alliance is a bonus. Have you actually met Sera?",
    "She files people. She filed me. I have never in my life been so thoroughly flattered.",
    "I'm also marrying Osric Vale in the autumn. He shoes his own horses. Have you seen his hands?",
    "I would sign away the entire Ember Coast for those hands, and I'd do it in front of a notary.",
    "Right. Beat me and I'll tell you which of the three of us is actually running the bloc.",
  ],
  gym6_defeat: [
    "LEONORE: Oh, that was rude. Do it to Hollis and I'll pay for whatever coat you ruin.",
    "Ember Badge. And the answer is me. It's me. In the counting house and everywhere else.",
    "Sera is certain it's her. Hollis is certain it's him. That is precisely why it holds.",
  ],
  gym6_after: [
    "LEONORE: You'll hear I got engaged for the ports. I got engaged because he laughs at me.",
    "The ports went on the paperwork because Sera does the paperwork and Sera is thorough.",
    "TABITHA: And if something happens to him?",
    "LEONORE: Then I burn all three houses down, and I start with my own, and I do it sober.",
  ],

  // -------------------------------------------------------------------------
  // Gym 7 - SERA MOURNE, House Mourne. Everything written down. Nothing forgotten.
  // -------------------------------------------------------------------------
  gym7_intro: [
    "SERA MOURNE: Eleven minutes late. I've written it down. I write everything down.",
    "House Brack won't kill you at the table. Bad for the wine. They do it at the door,",
    "on the way out, coat half on, so the last thing you ever do is lose a fight with a sleeve.",
    "It's meant to be humiliating. It works. I have watched it work nine times.",
    "Leonore believes she runs our arrangement. She runs the parts of it I handed her.",
    "Hollis believes he's in the middle of it. He is exactly where I put him, to the inch.",
    "I know your route, your money, and both of your habits. Fight me anyway. I'd like to watch.",
  ],
  gym7_defeat: [
    "SERA: That was not in my notes. I'll amend them tonight and file you somewhere considerably higher.",
    "Mourne Badge. You're now a name three houses will read out loud on Thursday morning.",
    "For what it's worth, I enjoyed that, and I never say so. Don't repeat it to Leonore.",
  ],
  gym7_after: [
    "SERA: Somebody sold me your route in the spring. Cheap. That should worry you more than me.",
    "I won't apologise for buying it. I'll apologise for how little I had to pay.",
    "TABITHA: Say the name.",
    "SERA: You've known the name since the barn. You want it said in somebody else's voice.",
    "SERA: I don't do that for free. Bring me something Brack wants and I'll say it twice.",
  ],

  // -------------------------------------------------------------------------
  // Gym 8 - HOLLIS BRACK, House Brack. Charming. Genuinely dangerous. Hungry.
  // -------------------------------------------------------------------------
  gym8_intro: [
    "HOLLIS BRACK: There you are. Sit down and eat something, you look like an unpaid debt.",
    "Eight houses, one crown, and every single fucker at this table has already worked out",
    "which of the other seven they'd burn to get it. I'm just rude enough to say so before dessert.",
    "Sera says I'm exactly where she put me. Sera's right. It's my favourite place in Fenmark.",
    "Leonore says she runs us. Also right. That's the trick of letting people think they steer.",
    "Odd Marlow died at your gate with his coat half on. My people, and my money, but not my order.",
    "TABITHA: Does that distinction help either of us?",
    "BRACK: No. But it'll matter to a court, and one of us should be thinking about the court.",
  ],
  gym8_defeat: [
    "BRACK: Hah. Six people have come at me across this table. You're the first who finished the food.",
    "Crown Badge. Eight of eight. That makes you a candidate, whether you fancy the job or not.",
    "You'll want me dead for Marlow. Do it at a door. It's the only manners I have any respect for.",
  ],
  gym8_after: [
    "BRACK: The Table sits at Ostmere. Four of them. They chose the last three kings",
    "while eight houses screamed at each other about the seating. Nobody voted. Nobody noticed.",
    "Go through them, then go through Isolde March, and the crown is yours by Sunday.",
    "Refuse it and I'll take it instead, and you will have to stand there and watch me be good at it.",
  ],

  // -------------------------------------------------------------------------
  // The Table at Ostmere
  // -------------------------------------------------------------------------
  elite_1: [
    "RUTH ANSELL: Sit down, love, you're dripping on the flags. There's soup. There's always soup.",
    "I took forty-one heads for Aldous. I remember every name and what each of them wanted for supper.",
    "Number twelve asked for eggs, in March. I found him eggs and was late with the axe. He was very gracious.",
    "Now stand up. I haven't done this in nine years and I've missed it more than is decent.",
  ],
  elite_1_defeat: [
    "RUTH: Oh, that was lovely. Cruel in the middle. I do so like a cruel middle.",
    "Go through, and eat something at Drue's. That man lays a table like an apology.",
  ],
  elite_1_after: [
    "RUTH: Still here? Sit. There's soup. There is always soup and it has always been the same soup.",
    "I've started thinking about what you'd want for supper. Don't read into that, love. Eat up.",
  ],
  elite_2: [
    "NIKOLAI DRUE: You've seen my handwriting. Everybody in Fenmark has seen my handwriting.",
    "Dara Vantry paid me two crowns to write on a warden at four in the morning. I'd have done it free.",
    "I hold nine letters, four ledgers, and one very stupid poem by a man who now runs a house.",
    "I've never sold a word of it. Blackmail is a wage. Knowing is an entire life.",
    "Fight me, and afterwards I'll tell you who wrote to me the week you lost the kennels.",
  ],
  elite_2_defeat: [
    "NIKOLAI: Beautifully done. I'll write it up, and I'll be generous, which is rare and expensive.",
    "The letter came on Mourne paper in Kell ink. Somebody borrowed a desk. Somebody always does.",
  ],
  elite_2_after: [
    "NIKOLAI: You want the name. Everybody wants the name. Nobody wants it in my handwriting.",
    "Third drawer, under the poem. You may take it the day I die and not one hour before that.",
  ],
  elite_3: [
    "ODILE HARROW: Sixteen years I kept a vow of silence. Do you know what that does to a woman?",
    "It makes her the best informed person in the country and completely intolerable at dinner.",
    "The Order holds the bank, the orphanage, and the deeds under two of the badges you're wearing.",
    "I have forgiven murderers. I have not forgiven Margit Kell. It's a genuine theological problem.",
    "Kneel or don't. Then fight. God has been fine with either, and I have asked repeatedly.",
  ],
  elite_3_defeat: [
    "ODILE: Well. That's humbling, and I have had eleven years of practice at humbling.",
    "Go on through. Boyd has been polishing that helmet for three days and it was not dirty then.",
  ],
  elite_3_after: [
    "ODILE: I prayed about you last night. At length. Out loud. The choir has asked me to stop.",
    "God said nothing, so I've written to Margit Kell instead. See what you have reduced me to.",
  ],
  elite_4: [
    "BOYD TERN: You'll want to know if I'll swear to you. They all ask. None of them ask well.",
    "Nineteen years I held the eastern border for a man who died eating fruit in a warm room.",
    "Twelve thousand spears go to whoever walks out of this hall. That is our entire constitution.",
    "I don't drink, I don't scheme, and I've buried more friends than I ever managed to make.",
    "So make it quick. I'm old, I'm sober, and I have a funeral at four.",
  ],
  elite_4_defeat: [
    "BOYD: Right. Twelve thousand spears, and they're yours the moment March hands the thing over.",
    "She won't hand it over. She has never handed anything over in her life. Good luck in there.",
  ],
  elite_4_after: [
    "BOYD: Funeral went well. Six of us, one priest, and a man crying who had no business there.",
    "The spears are yours the day it's signed. I've told them. They took it better than I did.",
  ],
  champion_intro: [
    "ISOLDE MARCH: Sit. You've come a very long way and I have read every mile of the reports.",
    "I was chief of staff to Aldous for nineteen years. I ran this country. He named the horses.",
    "When he choked, eight houses spent four days arguing about seating, and I simply carried on.",
    "You'll have heard it called a coup. There was no coup. There was a Tuesday, and I was at the desk.",
    "They call me Champion because 'the woman who never left the building' won't fit on a coin.",
    "You've beaten eight houses and four ghosts. Beat me, and I'll hand you the worst job in Fenmark.",
    "I'd very much like to see you try. Nothing has been difficult in a year and it's making me stupid.",
  ],
  champion_defeat: [
    "The last of March's ferals goes down. Yours sits, considers the room, and starts grooming.",
    "TABITHA: That is not gloating. I want it on the record. It has already forgotten it happened.",
    "TABITHA: I have bred these animals my whole life and not one has ever been impressed by me.",
    "ISOLDE: Nineteen years. You did it in one summer, in that coat.",
    "The crown's on the sideboard. It's heavier than it looks and it is not even gold.",
    "Take it. And keep hold of whoever still laughs at you, because the job eats the rest.",
  ],
  champion_after: [
    "ISOLDE: They've given me a cottage, a pension, and a view of the water. It is very restful.",
    "Ask me something. Anything. I have reorganised that pantry twice and it isn't yet Thursday.",
  ],
  hall_of_fame: [
    "The Hall at Ostmere records the name, the animals, and the date. Nothing else. It never has.",
    "Eight houses will call you a usurper by Friday and swear to you by Sunday afternoon.",
    "TABITHA: Look at that. Crowned, filthy, and still holding the lead in my left hand.",
    "TABITHA: Marlow said bring them home fed. They came home fed. That's the part I'll tell people.",
    "Wren asked Thistle to dinner. Nobody died. It has been a very strange year for the north.",
    "Cass didn't come. Cass sent the good chair from the kennel, with no note at all.",
    "It is not an apology. Cass would want that clearly understood.",
  ],

  // -------------------------------------------------------------------------
  // After the crown. The game puts you back at your own gate, and this is
  // what is waiting there.
  // -------------------------------------------------------------------------
  crown_petitions: [
    "THE WARDEN OF THE CROSS-FEN: Majesty. Forgive me if I don't kneel. It's the collarbone.",
    "Three petitions came with that crown. Nobody mentioned those at Ostmere. They never do.",
    "One. Something on the Orrin road takes a sheep a night, whole, and leaves the shepherd.",
    "Lady Orrin wishes it noted that the thing has taste.",
    "Two. A wolf walks the Halloway road after dark. Twelve hundred spears have stopped counting it.",
    "Three. A bear the size of a toll house is asleep on the Whitlow road. Mourne has filed it.",
    "No house will go near any of them. That's what a crown is for, apparently. I did ask.",
  ],
  crown_petitions_done: [
    "THE WARDEN: Three petitions, three answers, and nobody had to form a committee.",
    "The houses are furious. Nineteen years they've had a king, and never once a result.",
    "Dara sends her regards and a towel. I'm to say the towel is not a metaphor. It is one.",
  ],
  beast_eagle: [
    "A shadow as wide as the road drops onto a sheep. It is not going to share the sheep.",
    "The Haast eagle looks you over the way Margit Kell looks over an unpaid account.",
    "TABITHA: Thirty years breeding animals and I have never once been sized up as a meal. Come on, then.",
  ],
  beast_wolf: [
    "It is sitting in the middle of the road with its feet together, like something with an appointment.",
    "TABITHA: Look at the shoulder on that. Look at the set of the head. Nobody bred that. Nobody could.",
    "It stands up. It keeps standing up for longer than a wolf should.",
  ],
  beast_bear: [
    "The Whitlow road has a hill in it that was not there in the spring. The hill is breathing.",
    "It opens one eye. The eye has seen kings come and go, and was not impressed by those either.",
    "TABITHA: Forty-four years old, Queen of Fenmark, and about to wake a cave bear on purpose.",
  ],
  rival_crown: [
    "CASS: Don't. I know what the Hall says. 'Cass didn't come.' I've read it four times.",
    "I came for the chair. That's all. It's a good chair and I sent it in a weak moment.",
    "TABITHA: You sent it with no note.",
    "CASS: The chair was the note. You've had nineteen years to learn my handwriting.",
    "Marlow kept this gate thirty years. Somebody has to stand at it. I hear the pay is insulting.",
    "Fight me for it. I win, I take the chair. You win, I take the broom. Either way I'm not sorry.",
  ],
  rival_crown_defeat: [
    "CASS: Fine, I'll take the broom. Give it here. No, the other end. I do know how a broom works.",
    "This isn't an apology, it's a job, and I want that written down by somebody who can spell.",
  ],
  rival_crown_after: [
    "CASS: Gate's swept. Your cat watched me do it and found three places I'd missed.",
    "I'm not staying. I'm just not leaving yet. Those are different, and you know they are.",
  ],

  // -------------------------------------------------------------------------
  // The swearing-in. Eight houses called you a usurper by Friday; by Sunday
  // each of them will swear to you, and not one will do it without a fight.
  // Spoken by a house head who has already lost to you once, after the crown.
  // -------------------------------------------------------------------------
  gym1_again: [
    "DARA: Majesty. Sit anywhere but that chair, it was Aubrey's. Listen to me, saying his name before August.",
    "House Vantry swears to nobody it hasn't beaten or bedded, and you are not my type. Up you get.",
  ],
  gym1_again_defeat: [
    "DARA: Sworn. The fen is yours, the wardens are yours, the towels were always yours. Mind the tooth.",
  ],
  gym2_again: [
    "MARGIT KELL: The crown owes House Kell sixty thousand. You inherited that on Sunday. My congratulations.",
    "Beat me again and I'll take a point off the interest. It is the most affection I have ever put in writing.",
  ],
  gym2_again_defeat: [
    "MARGIT: One point off the interest, entered in ink. Dace sends his regards, so it must be Tuesday. Good day.",
  ],
  gym3_again: [
    "THISTLE: Wren finally asked me to dinner. I said yes so fast a footman dropped a tray. Humiliating. Perfect.",
    "I am in a wonderful mood and I must hit something before I become unbearable. You'll do, Majesty.",
  ],
  gym3_again_defeat: [
    "THISTLE: Orrin swears. And tell Wren I lost beautifully. He worries when I win.",
  ],
  gym4_again: [
    "PELL: Sit and roll your sleeve up. A crown raises the pulse, and the number of people who want you opened.",
    "I'd swear House Pell to you now, but I never sign for a patient I haven't examined. So, fight me.",
  ],
  gym4_again_defeat: [
    "PELL: Sound heart, bad knees, appalling coat. Pell swears. Come back in a month and bring the cat.",
  ],
  gym5_again: [
    "WREN: I asked her to dinner. I'd written it on my hand in case I lost the words, and I lost the words.",
    "She said yes anyway, and I haven't sat down since. Fight me. I need one thing today to go to plan.",
  ],
  gym5_again_defeat: [
    "WREN: Twelve hundred spears, sworn. I'd kneel, but she can see me from the ridge and I'd never hear the end.",
  ],
  gym6_again: [
    "LEONORE: The wedding's in October. Sera drew up the seating. Hollis is between two bishops, as a punishment.",
    "Ashgrove swears to whoever beats me in my own counting house. It's a short list. You, and the farrier.",
  ],
  gym6_again_defeat: [
    "LEONORE: Sworn and sealed, and I've put you at the top table. Wear something else. Anything else.",
  ],
  gym7_again: [
    "SERA MOURNE: I had your coronation in the book for the ninth. You were two days early. I ruled a new page.",
    "House Mourne swears in writing or not at all. I'll have the fight first. I like a document to be accurate.",
  ],
  gym7_again_defeat: [
    "SERA: Mourne swears. I've filed it under 'Things I did not arrange'. It's a thin file. Don't tell Leonore.",
  ],
  gym8_again: [
    "BRACK: Majesty, eat. I've had the door taken off its hinges as a courtesy, so you can stop watching it.",
    "You still want me dead for Marlow. Good, a queen should want something. Come and take the oath out of me.",
  ],
  gym8_again_defeat: [
    "BRACK: House Brack swears. I'll walk you out myself, and hold your coat while you get both arms in.",
  ],

  // -------------------------------------------------------------------------
  // Services
  // -------------------------------------------------------------------------
  lodge_heal: [
    "LODGE KEEPER: Beds are two crowns, the animals eat free, and I don't want the news.",
    "Right. Fed, warm, and one of yours has taken my chair on what looks like a permanent basis.",
    "Sleep while you can. Half this county does its best work between midnight and the milk cart.",
  ],
  kennel_greet: [
    "KENNELHAND: Thirty stalls, clean straw, and no, I don't care what you've called any of them.",
    "Leave the ones you can't walk. Take the ones you miss. I keep count and I keep quiet.",
  ],
  kennel_leave: [
    "Go on. They eat better in here than you do on the road, and they complain a great deal less.",
  ],
  shop_greet: [
    "QUARTERMASTER: If it kills something, mends something or hides something, it's on a shelf.",
    "Top shelf you can't afford, and I'd rather you didn't handle it with those hands.",
  ],
  shop_buy: [
    "Sold. No receipt, no returns, and if Margit Kell asks, you were never in this building.",
  ],
  shop_leave: [
    "Off with you. And tell Vantry her order's late because her wardens keep arriving broken.",
  ],
  blackout: [
    "Everything you brought is down. You are face down in a ditch that House Kell owns by deed.",
    "Somebody drags you to the nearest lodge and takes a coin for it. Everyone here takes a coin.",
    "TABITHA: Alive, fed, and four crowns owed to a stranger with a cart. Get up. Get up.",
  ],

  // -------------------------------------------------------------------------
  // Townsfolk. Two to a town, and each of them is talking about THIS town:
  // the house that runs it, and what living under that house is like.
  // -------------------------------------------------------------------------
  town_fenmark_a: [
    "You're the Astacio woman. My sister bought a hound off you in the spring.",
    "It has eaten two chairs and a will. She says it's the best money she ever spent.",
    "She wasn't in the will.",
  ],
  town_fenmark_b: [
    "The rider in the good black stopped here for water. I charged him for the water.",
    "A king's dead, and I'm sorry for it, and I have a roof that wants mending by Friday.",
  ],
  town_harrowfen_a: [
    "Every door in Vantry Fen bars from the outside. Dara calls it hospitality.",
    "My husband was her guest for a fortnight. He calls it the best two weeks of his marriage.",
  ],
  town_harrowfen_b: [
    "Nobody says the brother's name at her. Eleven weeks. We say 'the weather' and mean Aubrey.",
    "It has been a very hard season for weather.",
  ],
  town_saltmere_a: [
    "I owe House Kell nine crowns. Margit sent a man round to tell me that she knew.",
    "That's all he said. He had a cup of tea and left. I have not slept since the Tuesday.",
  ],
  town_saltmere_b: [
    "Dace ties up at the wharf at dusk on a Tuesday and he's cast off again by six.",
    "Twenty years on the barges and that is the only thing the man has ever been on time for.",
  ],
  town_ashgrove_a: [
    "Lady Orrin crossed the market in the grey silk and a cart went straight into the fountain.",
    "The carter isn't sorry. He's asked for it to be put on his headstone, with the date.",
  ],
  town_ashgrove_b: [
    "Eleven years those two have been at it. By 'it' I mean letters about drainage.",
    "I've a wager on him asking her by spring, and a roof I can't mend until it pays.",
  ],
  town_briarhold_a: [
    "Pell set my arm, and told me who broke it, how drunk he was, and whose brandy it had been.",
    "I'd only asked about the arm. Now I can't look at my brother-in-law.",
  ],
  town_briarhold_b: [
    "Two ways into the Pell infirmary. On your feet, or carried in from somebody's wedding.",
    "Boots off at the door either way. Pell has taken them off dead men who argued.",
  ],
  town_kestrelbridge_a: [
    "Twelve hundred spears on this pass, and every man of them has read that letter.",
    "We put it to a vote in the yard. It was unanimous. He should send the bloody thing.",
  ],
  town_kestrelbridge_b: [
    "Lord Halloway held this road against two armies and never once sat down.",
    "Thistle Orrin wrote back to him in March. One line. He had to be helped onto a barrel.",
  ],
  town_blackmourne_a: [
    "Osric Vale mended my gate last week. There was nothing the matter with my gate.",
    "There is a queue of women with broken gates from here to the harbour, and I started it.",
  ],
  town_blackmourne_b: [
    "Three houses in one bed and not one of them will agree who pays the laundress.",
    "I'm the laundress. I've started charging by the house. Mourne asked for a receipt.",
  ],
  town_whitlow_a: [
    "Sera Mourne knows what I had for breakfast. That I can live with.",
    "She has also written down what I'll be having tomorrow, and the woman is not wrong.",
  ],
  town_whitlow_b: [
    "It hasn't stopped snowing in Whitlow since the funeral. Mourne has a clerk out measuring it.",
    "Nobody knows who the report is for. All we know is that somebody will be blamed.",
  ],
  town_brackhall_a: [
    "You'll be fed at Brackhall, and fed well. Eat slowly. Thank the cook by name.",
    "And get your coat on, both arms, while you are still sitting at the table.",
  ],
  town_brackhall_b: [
    "My brother dined with Hollis Brack in the spring. A lovely evening, by all accounts.",
    "All of the accounts stop at the door.",
  ],
  town_cross_fen_a: [
    "Four of them sit in that hall, and between them they picked the last three kings.",
    "I asked what the Table is paid. Nobody knows. That's how you can tell it is a great deal.",
  ],
  town_cross_fen_b: [
    "The Warden of the Cross-Fen came through with his arm in a sling, smiling like a lit window.",
    "Says he'd do the whole thing again. He is saving up for it.",
  ],

  // -------------------------------------------------------------------------
  // NPC gossip
  // -------------------------------------------------------------------------
  npc_gossip_1: [
    "Margit Kell's bargeman only comes on Tuesdays. Half the wharf sets its clock by that woman.",
  ],
  npc_gossip_2: [
    "Halloway wrote to Orrin again. Four lines, three about drainage.",
    "The whole north is exhausted and none of us are even in the letter.",
  ],
  npc_gossip_3: [
    "Three houses in one arrangement and one vote between them.",
    "My uncle counts them as a single house. My uncle is unpleasant and my uncle is correct.",
  ],
  npc_gossip_4: [
    "They found the Warden of the Cross-Fen face down in Vantry's herb garden, smiling, in a towel.",
  ],
  npc_gossip_5: [
    "There's a bucket in Pell's back room and every soul in this town knows whose knee is in it.",
  ],
  npc_gossip_6: [
    "Abbess Harrow kept a vow of silence for sixteen years.",
    "She has been making up the shortfall daily and the choir has started drinking.",
  ],
  npc_gossip_7: [
    "The king's fruiterer ran to Ottrey that same night. Still there. Still writing to say it wasn't him.",
    "Four men taste the fruit at Ostmere now. Four. For fruit. Somebody draws a wage off that plum.",
  ],
  npc_gossip_8: [
    "Brack's people never kill you at the table. They do it at the door, with your coat half on.",
    "So I've had every coat I own cut loose enough to go on in one move. Cost me a fortune. Worth it.",
  ],
  npc_gossip_9: [
    "Leonore Ashgrove is marrying a farrier and half the Ember Coast has written poems about it.",
    "Not about her, mind. About his forearms. There's already a collected edition.",
  ],
  npc_gossip_10: [
    "Boyd Tern has turned down a lordship twice. Said the paperwork would interfere with the funerals.",
  ],
  npc_gossip_11: [
    "Astacio's grey cat walked into the Kell counting house and sat down on the open ledger.",
    "Nobody moved him. Nobody was going to be the one who tried.",
  ],
  npc_gossip_12: [
    "Somebody sold Kell the flaw in the Astacio deed. Cheap, too.",
    "Everyone wants the name said out loud. Everyone has guessed it. Nobody wants to go first.",
  ],

  npc_gossip_13: [
    "Vantry pays her wardens in coin and her calligrapher in wine.",
    "The calligrapher is the one she can't replace. He knows it. He's on the good wine now.",
  ],
  npc_gossip_14: [
    "I carried a letter from Halloway to Orrin once. Four days' ride over the ridge.",
    "He caught me up at the first bridge, took it back, and paid me double to forget the address.",
  ],
  npc_gossip_15: [
    "Kell lent my father forty crowns in a bad winter. We have paid it back three times over.",
    "The sum has never got one crown smaller. Margit says that's arithmetic. I say it's weather.",
  ],
  npc_gossip_16: [
    "Pell cut an arrowhead out of my cousin at dinner and told the whole table whose it was.",
    "The meal went on another hour. Nobody passed the salt. Nobody dared reach.",
  ],
  npc_gossip_17: [
    "They say Aldous named every horse in the royal stable himself. Forty horses.",
    "Nineteen years of war, and that is what the man did with it.",
  ],
  npc_gossip_18: [
    "Lady Ashgrove's farrier has ruined this county for the rest of us.",
    "My wife looked at my hands on Sunday and sighed. Out loud. In church.",
  ],
  npc_gossip_19: [
    "House Mourne keeps a file on everyone. I went to Whitlow and asked to see mine.",
    "They said I'd seen it already, and showed me the entry where I had asked.",
  ],
  npc_gossip_20: [
    "The Abbess blessed my hound, then talked for an hour about Margit Kell and damnation.",
    "The hound got up and left half way through. I wasn't allowed to.",
  ],
  npc_gossip_21: [
    "Boyd Tern buried nine men last month and went to all nine himself.",
    "Stood at the back in the rain. Brought his own shovel. Wouldn't take the good chair.",
  ],
  npc_gossip_22: [
    "Ruth Ansell took forty-one heads for the old king and knows what each one wanted for supper.",
    "I would not sit down to eat with her. I'd be flattered to be asked, mind.",
  ],
  npc_gossip_23: [
    "March ran this country for nineteen years and the king never noticed.",
    "Then the king died, and the country never noticed that either.",
  ],
  npc_gossip_24: [
    "My sister married a Brack. A lovely man. He holds the door for everybody.",
    "In nine years of marriage she has never once seen anybody take him up on it.",
  ],

  // -------------------------------------------------------------------------
  // Beaten road trainers and gym guards. The reducer says `<npc.dialogue>_after`
  // once the npc's flag is set, so every gossip key used as an npc dialogue
  // field needs one of these or the player reads a placeholder off the screen.
  // Each one answers the gossip it hangs off, from a person who has just lost.
  // -------------------------------------------------------------------------
  npc_gossip_2_after: [
    "Beaten on a public road by a woman with a wet dog. I'll write it up and cross out the good part.",
  ],
  npc_gossip_3_after: [
    "My uncle will have heard about this by supper. My uncle hears everything by supper. I hate him.",
  ],
  npc_gossip_4_after: [
    "Fine. Take the money. I'd rather be beaten out here than found smiling in somebody's herb bed.",
  ],
  npc_gossip_5_after: [
    "I'm going to Pell's. Not for the arm. For my pride, which is in roughly the same condition.",
  ],
  npc_gossip_6_after: [
    "The Abbess says a loss is good for the soul. The Abbess has never lost anything but her voice.",
  ],
  npc_gossip_7_after: [
    "Ruined in an afternoon, by a stranger, in the open. My father went out with considerably less.",
  ],
  npc_gossip_8_after: [
    "Go on, out the door ahead of me. Nothing will happen. I would simply like to know that for certain.",
  ],
  npc_gossip_9_after: [
    "Beaten in front of the whole road. Somebody will write a poem. It won't be about my forearms.",
  ],
  npc_gossip_10_after: [
    "Tern held a border for a decade. I held a hedge for six minutes. We are not the same soldier.",
  ],
  npc_gossip_11_after: [
    "Your animal watched the entire thing. I felt reviewed. I did not care to be reviewed.",
  ],

  npc_gossip_1_after: [
    "Beaten on a road, mid-week, by a stranger. Margit Kell would bill me for the use of the road.",
  ],
  npc_gossip_12_after: [
    "I'll say this for losing. Nobody asks you for names afterwards. They just step over you.",
  ],
  npc_gossip_13_after: [
    "I'd have this written up, but the only calligrapher in the fen is booked through August.",
    "These days he mostly writes on wardens.",
  ],
  npc_gossip_14_after: [
    "Twice now I've been stopped on a road by somebody with better reasons than mine.",
    "At least you didn't take a letter off me.",
  ],
  npc_gossip_15_after: [
    "Take the purse. It was Kell's money. It is always Kell's money. I only carry it about for her.",
  ],
  npc_gossip_16_after: [
    "If I take this to Pell he'll tell the county how I came by it. I'll limp.",
    "A limp keeps its mouth shut.",
  ],
  npc_gossip_17_after: [
    "Nineteen years of war and he got to name forty horses.",
    "I lasted four minutes and I didn't get to name a thing.",
  ],
  npc_gossip_18_after: [
    "My wife will hear about this, and she will sigh again. That farrier has a lot to answer for.",
  ],
  npc_gossip_19_after: [
    "That'll be in my file by Thursday. 'Lost on the road. Took it badly.'",
    "They're thorough at Mourne. They will get the second part exactly right.",
  ],
  npc_gossip_20_after: [
    "The Abbess says a beating is a gift from God. The Abbess says a great many things.",
    "The hound had the right idea.",
  ],
  npc_gossip_21_after: [
    "Don't trouble Tern with it. I'm not dead, I'm embarrassed, and he won't do a service for that.",
    "I asked.",
  ],
  npc_gossip_22_after: [
    "Well. If Ruth Ansell ever comes for me, I'll ask for eggs.",
    "It worked out all right for number twelve. Briefly.",
  ],
  npc_gossip_23_after: [
    "Nobody will notice this, either. That's the one comfort of the age.",
    "Go on. I have a ditch to lie in and I'd like to get started.",
  ],
  npc_gossip_24_after: [
    "After you. No, I insist. I only married into that family. I never picked up the habit.",
  ],

  // -------------------------------------------------------------------------
  // Signs
  // -------------------------------------------------------------------------
  sign_1: [
    "VANTRY FEN. Every room is warm and every door bars from the outside.",
    "Sleep well.",
  ],
  sign_2: ["KELL TOLL ROAD. Four crowns a cart. Eleven crowns if you argue about it."],
  sign_3: [
    "ORRIN RIDGE. The mountain road is open.",
    "House Orrin can close the mountain road. Be pleasant on the mountain road.",
  ],
  sign_4: ["OSTMERE. The Table sits here. No spears past this post. No exceptions. No, not you."],
  sign_5: ["HOUSE PELL INFIRMARY. Weapons in the barrel. Grudges in the barrel. Boots off."],
  sign_6: [
    "NOTICE: By order of House Brack, this gate closes at dusk.",
    "Leave before then, and leave with your coat on properly.",
  ],

  sign_7: [
    "FENMARK. Astacio kennels, first gate on the left.",
    "No credit. That includes you, my lord.",
  ],
  sign_8: [
    "SALTMERE. House Kell weighs every cart in and every cart out.",
    "Other scales are available. They are also owned by House Kell.",
  ],
  sign_9: [
    "HALLOWAY PASS. Twelve hundred spears. State your business.",
    "If your business is Lady Orrin, state it faster than Lord Halloway ever has.",
  ],
  sign_10: [
    "EMBERWICK. Seat of House Ashgrove. Three crests on the gate.",
    "Do not ask the porter which of them goes on top.",
  ],
  sign_11: [
    "WHITLOW. House Mourne. Your arrival has been noted.",
    "So has the hour. So has the state of your boots.",
  ],

  // -------------------------------------------------------------------------
  // System lines
  // -------------------------------------------------------------------------
  catch_success: [
    "Caught. It sits down, looks you over, and decides you'll do for the time being.",
  ],
  catch_fail: [
    "It breaks out, deeply insulted, and puts a professional amount of distance between you.",
  ],
  box_full: [
    "The box is full. Fenmark caps a single household at thirty animals.",
    "You campaigned two years for that law. You are now going to try to argue with it.",
  ],
  evolve: [
    "Something goes wrong with its shape. Then right. Then extremely right.",
    "It stands taller and looks at you as though you have been holding it back for months.",
  ],
  badge_get: [
    "Badge taken. That house now has to be polite about you in writing, and it will cost them.",
  ],
});

const MISSING_PREFIX = "(no line written for ";

/**
 * Look up a dialogue block. Unknown keys return a visible placeholder rather
 * than throwing, so a bad key shows up on screen in playtesting instead of
 * killing the reducer mid-battle.
 */
export function getDialogue(key: string): readonly string[] {
  const lines = DIALOGUE[key];
  if (lines !== undefined && lines.length > 0) return lines;
  return [`${MISSING_PREFIX}${key})`];
}
