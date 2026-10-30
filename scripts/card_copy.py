"""Section-specific card copy for the three public demos.

Bodies are authored from the MIDI (chord change, kick grid, density, ghosts,
register, and what the previous section did). They are not fill-in templates.
Figure sentences only name degrees and beats that the highlighted attacks play.
"""

# song slug -> section id -> fields
# figure body is a string. Others are (title, body).
# miss_steps are pattern-relative steps the mistake is about.
CARD_COPY = {
    "pocket-funk": {
        "intro": {
            "pocket": (
                "Hats, then a late kick",
                "Hats run alone for two bars. Bass enters only on bar 3, and the kick under it is just beats 1 and 3.",
            ),
            "figure": (
                "After the empty opening, three notes arrive: the root on 1, the root again on the and of 2, "
                "and down to the minor seventh on the a of 2. None of those attacks has a kick yet."
            ),
            "harmony": (
                "Am7 from the first hat",
                "Am7 (i7) is the only chord in the intro. Its color is A–C–E–G, and the bass does not state it until bar 3.",
            ),
            "missable": (
                "Don't fill the hat bars",
                "Bars 1 and 2 are hats with no bass. Playing the funk line early covers the silence that makes the entrance.",
                [0, 8],
            ),
        },
        "a1": {
            "pocket": (
                "Kick joins the and of 2",
                "Groove A keeps the 8th hats but adds a kick on the and of 2 and another on the last 16th. Snare stays on 2 and 4.",
            ),
            "figure": (
                "Offbeat kicks are the new partner. Downbeat root meets one. So does the root on the and of 2. "
                "The minor seventh on the a of 2 is the attack left in the crack between those kicks."
            ),
            "harmony": (
                "Eight bars, still Am7",
                "Harmony does not move for these eight bars. Am7 keeps the A–C–E–G color while the rhythm section gets busier.",
            ),
            "missable": (
                "Don't drop the and-of-2 kick",
                "The and-of-2 kick is the new event. Leaving it out turns Groove A back into the sparser intro grid.",
                [6, 0],
            ),
        },
        "a2": {
            "pocket": (
                "Ghosts and octave pops",
                "Same kick grid, denser bass. Ghost snares sit just before the backbeat, and soft bass 16ths answer them. Don't rush a ghost.",
            ),
            "figure": (
                "Register is the story: low root on 1, octave on the a of 1, then the low root returns on the and of 2. "
                "Outer notes share kicks. The pop in the middle does not."
            ),
            "harmony": (
                "Am7 under the pops",
                "The octave pops are still Am7. Nothing in the chord stack changes; only the register and the ghosts are new.",
            ),
            "missable": (
                "Don't accent the ghost 16ths",
                "The bass ghosts are the quiet 16ths after beat 2, not the downbeat. Playing them as loud as the root on 1 kills the pocket.",
                [10, 0],
            ),
        },
        "b1": {
            "pocket": (
                "Same kick, new root",
                "The kick pattern stays the Groove A grid, including the and of 2. What moves is the bass root, up to D.",
            ),
            "figure": (
                "A is gone. D is the root on 1 and it locks with the kick. Up to the major third on 2 is F#, the announcement. "
                "D returns as the root on the and of 2, and that one locks with the kick too."
            ),
            "harmony": (
                "Lift to D7",
                "This is the first chord change: D7, IV7 in A minor. Bass roots on D and uses F# as the third, not the old A pedal.",
            ),
            "missable": (
                "Don't keep the A from Groove A",
                "The D7 bar moves to F# on 2. Easy to play the A from the groove by habit and miss the third.",
                [4, 0],
            ),
        },
        "a3": {
            "pocket": (
                "Am7 grid returns",
                "After D7 the and-of-2 kick and the 8th hats come back with A in the bass. Six bars, not the eight of Groove A.",
            ),
            "figure": (
                "After D7, the first groove's shape is back. Kick shares the downbeat root and the and-of-2 root. "
                "Between those, the minor seventh on the a of 2 is unchanged."
            ),
            "harmony": (
                "Back to Am7",
                "D7 lasts through the lift only. Harmony here is Am7 again, so F# from the third no longer belongs.",
            ),
            "missable": (
                "Don't hold the F#",
                "F# belonged to D7. On the return the downbeat is A, and keeping the third from the lift fights Am7.",
                [0, 7],
            ),
        },
        "br": {
            "pocket": (
                "Kicks thin to 1 and 3",
                "Hats drop from every 8th to quarters, and the kick leaves the offbeats. Snare clusters at the end of the bar instead of a plain 2 and 4.",
            ),
            "figure": (
                "E7 is the chord and the bass will not play E. Fourth on 1 sits in a kick. Fourth on 3 sits in the other kick. "
                "The octave on 4 is the only higher A, and it is kickless."
            ),
            "harmony": (
                "E7 with an A pedal",
                "Three bars of E7, the V7. The bass pedals A, the fourth, so the dominant is in the chord while the bass refuses the root.",
            ),
            "missable": (
                "Don't resolve to E yet",
                "E7 wants an E in your ear. The written bass stays on A, the fourth, on 1 and on 3. An early E jumps the return.",
                [0, 8],
            ),
        },
        "out": {
            "pocket": (
                "Long roots, busy kick",
                "The offbeat kick grid returns, but the bass shrinks to three long notes a bar. Let the kit carry the 16ths.",
            ),
            "figure": (
                "Only A, and plenty of space around it. The root on 1 is a long one, the root again on 3 answers it, "
                "and the octave on the and of 4 is a short tag. The first two share the kick; the tag does not."
            ),
            "harmony": (
                "Am7 to the end",
                "E7 is over. The outro sits on Am7 with long A roots and no further chord move.",
            ),
            "missable": (
                "Don't restart the busy 16ths",
                "Groove A's subdivisions do not belong in the outro. Three A attacks are the whole bar; a fill between them crowds the ending.",
                [0, 14],
            ),
        },
    },
    "radio-pop": {
        "intro": {
            "pocket": (
                "Four-on-the-floor, bass waits",
                "Kick on every quarter and 8th hats from the top. Bass is silent for two bars, then enters with halves.",
            ),
            "figure": (
                "Halves, not the verse 8ths that come later. Root on 1 sits under the downbeat kick. Up to the fifth on 3 sits under the beat-3 kick."
            ),
            "harmony": (
                "C alone, then the bass",
                "The intro never leaves C. Bass states the root and the fifth only, in half notes, after the kit has already set the floor.",
            ),
            "missable": (
                "Don't start the verse 8ths early",
                "The entrance is two halves. Playing the verse's root-fifth 8ths on bar 3 rushes a moment that is supposed to be long.",
                [0, 8],
            ),
        },
        "v1": {
            "pocket": (
                "Quarters and 8ths on the floor",
                "Kick remains four-on-the-floor and snare is on 2 and 4. Bass leaves the halves behind for quarters plus 8ths, root then fifth.",
            ),
            "figure": (
                "Order is root, root, fifth. Root on 1 is a quarter with the downbeat. Root on 2 meets the next kick. "
                "The fifth on the and of 2 falls in the gap."
            ),
            "harmony": (
                "Two bars per chord",
                "Harmony walks C, G, Am, then F, each chord lasting two bars. Bass roots every change instead of pedaling C.",
            ),
            "missable": (
                "Don't jump chords early",
                "Each chord owns two bars. Changing bass root after one bar anticipates G, Am, or F before the harmony does.",
                [0, 6],
            ),
        },
        "pre": {
            "pocket": (
                "Quarters outline the chord",
                "The floor stays four kicks a bar. Bass stops vamping and plays a quarter-note arpeggio, one chord tone per beat.",
            ),
            "figure": (
                "Quarters climb the Dm triad, and the floor has a kick on every beat so each tone lands in one. "
                "Root on 1, then the minor third on 2, then the fifth on 3."
            ),
            "harmony": (
                "Dm then G7",
                "Two bars of Dm, then two of G7. The G7 bar's last quarter is F, the seventh, which the Dm arpeggio did not have.",
            ),
            "missable": (
                "Don't play the verse 8ths here",
                "Beat 2 is the minor third, F, a full quarter. The verse's root-then-fifth 8ths skip that Dm arpeggio.",
                [4, 0],
            ),
        },
        "ch1": {
            "pocket": (
                "One bar per chord, plus an octave pop",
                "Still four-on-the-floor. Bass adds an octave on the last 16th of beat 1, then the fifth on 2, and the chord lasts only one bar.",
            ),
            "figure": (
                "The hook's 16th pop is the new event. Root on 1, octave on the a of 1, then down to the fifth on 2. "
                "Kicks catch the root and the fifth. The pop is between them."
            ),
            "harmony": (
                "One bar per change",
                "Harmony flips every bar: C then G then Am then F, and that loop runs twice. The verse had given each of those chords two bars.",
            ),
            "missable": (
                "Don't stay on the fifth at the end of the bar",
                "Beat 4 is the fifth, but the and of 4 steps outside the chord (F# when the bar is C). Holding G there misses the hook's exit.",
                [12, 14],
            ),
        },
        "v2": {
            "pocket": (
                "Verse grid plus a chord tone on 3",
                "Four-on-the-floor and snare on 2 and 4 return. Unlike verse 1, beat 3 splits into 8ths and the second one is a chord tone.",
            ),
            "figure": (
                "Opening matches verse 1; the added chord tone is not in these three attacks. "
                "Root on 1, root on 2, then the fifth on the and of 2."
            ),
            "harmony": (
                "Verse chords, beat 3 filled",
                "Harmony repeats the verse order, two bars apiece, from C through F. New inside the bar: a chord tone on the and of 3, E when the chord is C.",
            ),
            "missable": (
                "Don't turn beat 3 into a fill",
                "The and of 3 is a chord tone (E on the C bars), one 8th. Running a longer lick there overplays a single added note.",
                [10, 8],
            ),
        },
        "br": {
            "pocket": (
                "Half-note roots, fifth on the and of 2",
                "The kick grid does not change. Bass slows to a dotted quarter, a short fifth, then a half-note octave, and leaves the 16ths alone.",
            ),
            "figure": (
                "Slow, and wide, next to the chorus hook. Root on 1 is long. The fifth on the and of 2 is the short note. "
                "Octave on 3 is a half note under the beat-3 kick."
            ),
            "harmony": (
                "Opens on Am",
                "Harmony leaves the chorus loop. It opens on Am, passes F and C, and cadences on G7, two bars each.",
            ),
            "missable": (
                "Don't import the chorus octave pop",
                "The chorus 16th pop on the a of 1 is absent. The octave arrives on 3, as a half note, so an early pop belongs only to the chorus.",
                [0, 8],
            ),
        },
        "ch2": {
            "pocket": (
                "Chorus hook, then a C pedal",
                "The octave pop and one-bar changes return, but the last four bars stop changing and sit on C. The kit never syncopates with that pop.",
            ),
            "figure": (
                "Exit uses the hook, then the harmony parks. Root on 1, the octave on the a of 1 pops once more, "
                "and fifth on 2 answers underneath the following kick."
            ),
            "harmony": (
                "Chorus changes, then hold C",
                "The one-bar chord changes return, and unlike the first chorus the phrase stops by holding C instead of repeating the loop.",
            ),
            "missable": (
                "Don't keep changing chords in the last four bars",
                "After the loop, the harmony parks on C. Another G or F in those bars invents a change the outro does not make.",
                [0, 14],
            ),
        },
    },
    "backbeat-rock": {
        "intro": {
            "pocket": (
                "Backbeat, bass waits",
                "Kick on 1 and 3 only, hats on the 8ths, snare on 2 and 4. This is not four-on-the-floor. Bass waits two bars, then plays halves on E.",
            ),
            "figure": (
                "Two halves and nothing else. Root on 1 is the entrance, under the beat-1 kick. Root on 3 is the answer, under the beat-3 kick."
            ),
            "harmony": (
                "Em, stated late",
                "Four bars of Em and no other chord. Bass plants the root in halves only after the backbeat has been heard alone.",
            ),
            "missable": (
                "Don't play the verse 8ths yet",
                "Bar 3 is two E halves on the root. The straight-8th motor of the verse starts later; starting it here erases the wait.",
                [0, 8],
            ),
        },
        "v1": {
            "pocket": (
                "Straight 8ths under 1 and 3",
                "Kick stays on 1 and 3 with snare on 2 and 4. Bass becomes continuous 8ths: root, fifth, and an octave, glued to that backbeat.",
            ),
            "figure": (
                "8ths replace the intro halves. Root on 1 starts the motor under a kick. Root on the and of 1 keeps it moving. "
                "The fifth on 2 lands on the snare, not on a kick."
            ),
            "harmony": (
                "Em G D Am, two bars each",
                "The verse leaves Em. Order is Em, G, D, then Am, and each chord gets two bars while the 8th motor keeps the same shape.",
            ),
            "missable": (
                "Don't swing the 8ths",
                "Every bass 8th is straight. The fifth on 2 is on the snare, not a swung offbeat, and treating it as funk 16ths breaks the rock motor.",
                [4, 2],
            ),
        },
        "pre": {
            "pocket": (
                "8ths through C, then B7",
                "Kick grows an and-of-2 on the way to B7. Bass keeps straight 8ths but the chords are C then B7, and the last 8th of B7 is D#.",
            ),
            "figure": (
                "C in straight 8ths, not the Em riff. Root on 1 is with the beat-1 kick. "
                "Root on the and of 1 keeps the pedal. Root on 2 is still C, against the snare."
            ),
            "harmony": (
                "C into B7",
                "The chord move is two bars of C, the VI, then two of B7, the V7. That B7 aims back at Em, which the verse never used.",
            ),
            "missable": (
                "Don't import the Em fifth",
                "These bars pedal C. Beat 2 is the root again, not B, so the verse's fifth-on-2 riff does not fit.",
                [4, 0],
            ),
        },
        "ch1": {
            "pocket": (
                "Ride, and a pushed kick",
                "Hats leave and the ride takes the 8ths. Kick adds the and of 2. Bass stays in straight 8ths and the chord changes every bar.",
            ),
            "figure": (
                "Chorus 8ths linger on the root, unlike the verse figure. Root on 1 has the kick. "
                "Root on the and of 1 continues the 8ths. Root on 2 is still the root."
            ),
            "harmony": (
                "A new loop, one bar each",
                "Harmony changes every bar: Em then C then G then D, and that group plays twice. C and D were not neighbors in the verse.",
            ),
            "missable": (
                "Don't keep the verse's fifth on 2",
                "On the Em chorus bars, beat 2 is still the root. Dropping to B there copies the verse figure onto a different bar.",
                [4, 0],
            ),
        },
        "v2": {
            "pocket": (
                "Fifth moves to the off-8th",
                "Kick returns to 1 and 3 and the hats return. The 8th motor flips: the fifth is now on the and of 1, not on beat 2.",
            ),
            "figure": (
                "The fifth moved earlier. Root on 1 still takes the kick. The fifth on the and of 1 is the flip. "
                "Root on 2 answers, where verse 1 had put the fifth."
            ),
            "harmony": (
                "Em G D Am, fifth relocated",
                "Chords match the first verse: Em, G, D, Am, two bars each. The change is rhythmic, the fifth on the and of 1.",
            ),
            "missable": (
                "Don't put the fifth back on 2",
                "Verse 1 put the fifth on beat 2. Here that slot is the root again on 2, and the fifth already happened on the and of 1.",
                [2, 4],
            ),
        },
        "br": {
            "pocket": (
                "Halves while the backbeat continues",
                "Kick on 1 and 3 and 8th hats keep going. Bass drops from the 8th motor to a half note, a dotted quarter, and one short 8th.",
            ),
            "figure": (
                "Held notes instead of the 8th motor. Root on 1 is a half under the first kick. "
                "The fifth on 3 meets the second kick. Root on the and of 4 is the only short attack."
            ),
            "harmony": (
                "C G D B7, bass in long notes",
                "The breakdown moves C, G, D, then B7. B7 points back at Em, and the bass holds roots and fifths instead of running 8ths.",
            ),
            "missable": (
                "Don't fill the half notes",
                "Beat 1 is a half-note root. The straight-8th motor from the chorus does not belong under a bar that is mostly held.",
                [0, 8],
            ),
        },
        "ch2": {
            "pocket": (
                "Ride and pushed kick, then Em",
                "The chorus ride and the and-of-2 kick return. After one pass of the loop the last four bars stay on Em instead of cadencing away.",
            ),
            "figure": (
                "Ending reuses the chorus 8ths, then stays home. Root on 1 takes the opening kick. "
                "Root on the and of 1 keeps the motor. Root on 2 is still the root."
            ),
            "harmony": (
                "Chorus loop, ending on Em",
                "Harmony brings Em then C then G then D back for one bar each, then Em stays. The first chorus repeated its loop; this one stops.",
            ),
            "missable": (
                "Don't cadence to D at the end",
                "The last four bars are the Em chord, not another D. Moving to D there copies the middle of the loop after the song has already landed.",
                [0, 4],
            ),
        },
    },
}


def card_spec(song_key, sec_id):
    song = CARD_COPY.get(song_key) or {}
    spec = song.get(sec_id)
    if not spec:
        raise KeyError(f"no card copy for {song_key}/{sec_id}")
    return spec
