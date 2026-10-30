# Mirror tools

Build one side of a rig, then mirror it.

## Tools

In the **Scripts** menu:

- **Mirror selected bones**: flips the setup position and rotation of the selected bones across
  X = 0.
- **Swap left/right in names**: renames the selected bones (or every bone, when none is selected)
  to the other side: `arm_l` ↔ `arm_r`, `hand.L` ↔ `hand.R`, `leftEye` ↔ `rightEye`. A name that
  is already taken is left alone.

Each tool is one undo step.
