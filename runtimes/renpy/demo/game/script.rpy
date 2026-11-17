# SPDX-License-Identifier: MIT OR Apache-2.0
# Rigby2D for Ren'Py: demo. NILA talks (lip-synced to her voice lines), changes expressions with
# image attributes, waves, and looks at the mouse; Rigbytron joins her.

# A folder holding nila.json, nila.atlas and nila.png. Expressions are face animations layered
# over the body's motion; everything else is a motion.
image nila = Rigby("images/nila", height=1.25, expressions=["happy", "surprised", "thinking", "curious"], once=["wave"], look="mouse")
image rigbytron = Rigby("images/rigbytron", height=0.62)

define n = Character("Nila", image="nila", color="#7cc4ff")
define r = Character("Rigbytron", image="rigbytron", color="#ffd166")

# A Rigby image is as big as its setup pose: these place the top of each character on screen.
transform stand(x=0.5):
    xalign x
    yanchor 0.0
    ypos 0.09

transform robot(x=0.85):
    xalign x
    yalign 1.0
    yoffset 30

label start:
    scene expression Solid("#20242c")

    show nila idle at stand(0.5)
    with dissolve

    voice "voice/hello.mp3"
    n "Hi! I'm Nila, and I'm made of layers."

    voice "voice/moon.mp3"
    n "My name means moon."

    show nila wave
    voice "voice/curious.mp3"
    n curious "Need an expression?"

    voice "voice/happy.mp3"
    n happy "Happy!"

    voice "voice/surprised.mp3"
    n surprised "Surprised?"

    voice "voice/thinking.mp3"
    n thinking "Hmm... thinking."

    show nila idle -thinking
    show rigbytron hold at robot(0.85)
    with moveinright

    voice "voice/physics.mp3"
    n "Pure physics. I turn, and it follows."

    r "Without a voice line, my mouth... well, I don't have one. But the text still types at your speed."

    voice "voice/whisper.mp3"
    n "And right now, every word I say is lip-synced, straight from this audio."

    show rigbytron release
    voice "voice/wink.mp3"
    n happy "Lovely, isn't it?"

    return
